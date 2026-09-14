"""SKU + fotos → vídeo → reconhecimento → contagem consolidada."""
import hashlib
import logging
import re
import shutil
import sqlite3
import threading
import time
from pathlib import Path
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, StrictInt

from .config import Settings
from .domain import validate_identification, validate_count
from .providers import ProviderError, make_provider
from .storage import Store, now
from .video import extract_frames, select_counting_frames


class Correction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    counts: dict[str, StrictInt | None]


def create_app(settings: Settings | None = None):
    settings = settings or Settings.from_env()
    store = Store(settings.data_dir)
    media = settings.data_dir / "media"
    media.mkdir(exist_ok=True)
    static = Path(__file__).parent / "static"
    app = FastAPI(title="Contabot", version="0.2.0")
    app.state.settings, app.state.store = settings, store
    app.state.provider = make_provider(settings)
    worker_lock = threading.Lock()
    mutation_lock = threading.RLock()
    # Servidor local de um processo: uma execução interrompida pode ser repetida.
    for record in store.all("videos"):
        if record["status"] == "processing":
            record.update(status="failed", stage=None, error="A análise foi interrompida. Tente novamente.")
            store.save("videos", record)

    def url(path):
        return "/media/" + Path(path).relative_to(media).as_posix()

    def public(value):
        if isinstance(value, list):
            return [public(v) for v in value]
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                if key == "candidate_frames":
                    continue
                elif key == "path":
                    result["url"] = url(item)
                elif key == "source_path":
                    result["video_url"] = url(item)
                elif key == "photos":
                    result[key] = [url(p) for p in item]
                elif key == "photo":
                    result[key] = url(item)
                else:
                    result[key] = public(item)
            return result
        return value

    def get_video(identifier):
        record = store.get("videos", identifier)
        if record is None:
            raise HTTPException(404, "Vídeo não encontrado.")
        return record

    def save(record):
        record["updated_at"] = now()
        store.save("videos", record)
        return public(record)

    def upload_file(upload, destination, limit_mb):
        size, digest = 0, hashlib.sha256()
        try:
            with destination.open("wb") as out:
                while chunk := upload.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > limit_mb * 1024 * 1024:
                        raise HTTPException(413, f"Arquivo excede {limit_mb} MB.")
                    digest.update(chunk)
                    out.write(chunk)
            if not size:
                raise HTTPException(422, "O arquivo está vazio.")
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        finally:
            upload.file.close()
        return digest.hexdigest()

    def call_provider(record, stage, catalog, frames):
        record["stage"] = "identifying" if stage == "identify" else "counting"
        save(record)
        attempt = {"stage": stage, "created_at": now(), "provider": settings.provider,
                   "model": settings.model, "simulated": settings.provider == "mock", "usage": {}}
        try:
            response = getattr(app.state.provider, stage)(record, catalog, frames)
            attempt.update(usage=response.usage, model=response.model, simulated=response.simulated, request_id=response.request_id)
            validator = validate_identification if stage == "identify" else validate_count
            parsed = validator(response.prediction, record["id"], [s["id"] for s in catalog], [f["id"] for f in frames])
            attempt.update(status="completed", prediction=parsed.model_dump())
            record["model"] = response.model
            record["simulated"] = record["simulated"] or response.simulated
            return parsed.model_dump()
        except Exception as exc:
            attempt.update(status="failed", error_type=type(exc).__name__)
            attempt["usage"] = getattr(exc, "usage", attempt["usage"])
            attempt["request_id"] = getattr(exc, "request_id", attempt.get("request_id"))
            raise
        finally:
            record["attempts"].append(attempt)
            save(record)

    def process(identifier):
        with worker_lock:
            record = get_video(identifier)
            started = time.perf_counter()
            try:
                if not record.get("candidate_frames"):
                    extracted = extract_frames(Path(record["source_path"]), media / uuid4().hex,
                        sample_hz=settings.sample_hz, max_frames=settings.max_frames,
                        max_candidates=settings.max_candidates, max_duration_seconds=settings.max_duration_seconds)
                    record["candidate_frames"] = extracted["candidates"]
                    record["identification_frame_ids"] = extracted["selected_frame_ids"]
                    record["frames"] = [f for f in extracted["candidates"] if f["id"] in extracted["selected_frame_ids"]]
                    record["primary_frame_id"] = extracted["primary_frame_id"]
                    record["video_metadata"] = {k:v for k,v in extracted.items() if k not in {"candidates", "selected_frame_ids"}}
                    save(record)
                frames = [f for f in record["candidate_frames"] if f["id"] in record["identification_frame_ids"]]
                record["frames"] = frames
                record["primary_frame_id"] = record["video_metadata"]["primary_frame_id"]
                record.pop("counting_selection", None)
                catalog = record["catalog"]
                capacity = settings.max_images - len(frames)
                # Cada referência é examinada; não descartar SKUs para caber no limite.
                if any(len(s["photos"]) > capacity for s in catalog):
                    raise ProviderError("Há fotos demais para esta análise. Reduza o número de fotos por produto ou ajuste o limite de imagens.")
                batches, batch, used = [], [], 0
                for sku in catalog:
                    if used + len(sku["photos"]) > capacity:
                        batches.append(batch); batch, used = [], 0
                    batch.append(sku); used += len(sku["photos"])
                if batch:
                    batches.append(batch)
                matches, unknowns = [], []
                for batch in batches:
                    found = call_provider(record, "identify", batch, frames)
                    matches.extend(found["matches"])
                    unknowns.extend(found["unknown_products"])
                record["identification"] = {"video_id": identifier, "matches": matches, "unknown_products": list(dict.fromkeys(unknowns))}
                possible_ids = {m["sku_id"] for m in matches if m["status"] != "absent"}
                possible = [s for s in catalog if s["id"] in possible_ids]
                record["unknown_products"] = list(dict.fromkeys(unknowns))
                if not possible:
                    record.update(status="no_matches", stage=None)
                    return
                evidence_ids = {fid for match in matches if match["sku_id"] in possible_ids
                                for fid in match["evidence_frame_ids"]}
                image_budget = settings.max_images - sum(len(s["photos"]) for s in possible)
                if image_budget < len(frames):
                    raise ProviderError("Há produtos demais para distinguir nesta captura. Grave uma área menor e tente novamente.")
                count_budget = min(settings.max_count_frames, image_budget)
                context_frames = [f for f in frames if f["id"] not in evidence_ids]
                neighbors = select_counting_frames(record["candidate_frames"], sorted(evidence_ids),
                    count_budget - len(context_frames)) if evidence_ids else []
                by_frame = {f["id"]: f for f in [*frames, *neighbors]}
                frames = sorted(by_frame.values(), key=lambda f: f["timestamp_seconds"])
                record["frames"] = frames
                record["counting_selection"] = {"strategy": "recognition-neighbors-v1",
                    "identification_frame_ids": record["identification_frame_ids"],
                    "counting_frame_ids": [f["id"] for f in frames], "max_frames": count_budget,
                    "reason": "Preserva contexto e inclui ângulos próximos dos produtos reconhecidos; o modelo escolhe onde as unidades estão distinguíveis."}
                relevant = [f for f in frames if f["id"] in evidence_ids]
                if relevant:
                    primary = max(relevant, key=lambda f: f.get("metrics", {}).get("quality", 0))
                    record["primary_frame_id"] = primary["id"]
                    record["primary_selection_reason"] = "Melhor qualidade entre as evidências dos produtos identificados; cobertura ainda precisa ser verificada."
                # Contagem em UMA chamada com todos os candidatos à identificação.
                # Nunca somar contagens de imagens/batches que possam repetir caixas.
                if sum(len(s["photos"]) for s in possible) + len(frames) > settings.max_images:
                    raise ProviderError("Há produtos demais para distinguir nesta captura. Grave uma área menor e tente novamente.")
                prediction = call_provider(record, "count", possible, frames)
                record["prediction"] = prediction
                record["unknown_products"] = list(dict.fromkeys([*unknowns, *prediction["unknown_products"]]))
                by_sku = {s["id"]: s for s in possible}
                record["results"] = [{**c, "name": by_sku[c["sku_id"]]["name"],
                    "variant": by_sku[c["sku_id"]].get("variant", ""), "photo": by_sku[c["sku_id"]]["photos"][0],
                    "confirmed_quantity": None} for c in prediction["counts"]]
                pending = not prediction["coverage_complete"] or not prediction["overlap_resolved"] or any(c["incomplete"] or c["needs_review"] for c in prediction["counts"])
                record.update(status="needs_review" if pending else "completed", stage=None)
            except ProviderError as exc:
                record.update(status="failed", stage=None, error=str(exc)[:700])
            except ValueError:
                record.update(status="failed", stage=None, error="Não foi possível validar o vídeo ou a resposta. Tente outra captura.")
            except Exception as exc:
                logging.getLogger(__name__).error("Falha de análise (%s)", type(exc).__name__)
                record.update(status="failed", stage=None, error="A análise falhou. Confira a conexão e tente novamente.")
            finally:
                record["processing_seconds"] += time.perf_counter() - started
                save(record)

    @app.exception_handler(ValueError)
    async def value_error(request, exc):
        return JSONResponse(status_code=422, content={"detail": str(exc)[:700]})

    @app.exception_handler(RequestValidationError)
    async def invalid_input(request, exc):
        return JSONResponse(status_code=422, content={"detail": "Confira os campos obrigatórios e os valores informados."})

    @app.get("/")
    def index():
        return FileResponse(static / "index.html")

    @app.get("/api/config")
    def config():
        return {"provider": settings.provider, "model": settings.model, "simulated": settings.provider == "mock", "max_upload_mb": settings.max_upload_mb}

    @app.get("/api/skus")
    def skus():
        return public(store.all("skus"))

    def persist_sku(identifier, name, photos, variant, existing=None):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", identifier):
            raise HTTPException(422, "O código deve conter até 64 letras, números, hífen ou sublinhado.")
        if not name.strip() or len(name) > 160 or len(variant) > 160:
            raise HTTPException(422, "Informe o nome do produto, com até 160 caracteres.")
        if (photos or existing is None) and not 1 <= len(photos) <= min(4, settings.max_images - 1):
            raise HTTPException(422, "Cadastre de 1 a 4 fotos por produto, dentro do limite configurado.")
        directory = media / uuid4().hex
        if photos:
            directory.mkdir()
        paths = [] if photos else existing["photos"]
        try:
            for i, photo in enumerate(photos):
                original = directory / f"upload-{i}"
                upload_file(photo, original, 10)
                try:
                    with Image.open(original) as img:
                        if img.width * img.height > 30_000_000 or min(img.size) < 64:
                            raise ValueError("Use uma foto com pelo menos 64 pixels por lado e até 30 megapixels.")
                        img = ImageOps.exif_transpose(img).convert("RGB")
                        img.thumbnail((1920,1920))
                        output = directory / f"reference-{i}.jpg"
                        img.save(output, "JPEG", quality=94)
                        paths.append(str(output))
                except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
                    raise ValueError("Foto inválida. Use JPEG, PNG ou WebP.") from exc
                finally:
                    original.unlink(missing_ok=True)
            sku = {"id":identifier,"name":name.strip(),"variant":variant.strip(),"photos":paths,
                   "created_at":existing["created_at"] if existing else now(),"updated_at":now()}
            try:
                store.save("skus", sku, create=existing is None)
            except sqlite3.IntegrityError:
                raise HTTPException(409, "Já existe um produto com este código.")
            return public(sku)
        except Exception:
            shutil.rmtree(directory,ignore_errors=True)
            raise

    @app.post("/api/skus", status_code=201)
    def add_sku(name: str = Form(...), photos: list[UploadFile] = File(...), id: str = Form(""), variant: str = Form("")):
        return persist_sku(id.strip() or "sku-" + uuid4().hex[:12], name, photos, variant)

    @app.patch("/api/skus/{identifier}")
    def edit_sku(identifier: str, name: str = Form(...), photos: list[UploadFile] | None = File(None), variant: str = Form("")):
        with mutation_lock:
            existing = store.get("skus", identifier)
            if existing is None:
                raise HTTPException(404, "Produto não encontrado.")
            # Evidências de vídeos anteriores continuam apontando para as fotos antigas.
            return persist_sku(identifier, name, photos or [], variant, existing)

    @app.delete("/api/skus/{identifier}", status_code=204)
    def delete_sku(identifier: str):
        with mutation_lock:
            if not store.delete("skus", identifier):
                raise HTTPException(404, "Produto não encontrado.")
            # Vídeos guardam seu próprio catálogo; conservar fotos como evidências.
            return Response(status_code=204)

    @app.get("/api/videos")
    def videos():
        return [{k:v[k] for k in ("id","filename","status","created_at","simulated")} for v in store.all("videos")]

    @app.post("/api/videos", status_code=202)
    def add_video(background_tasks: BackgroundTasks, video: UploadFile = File(...), synthetic: bool = Form(False)):
        catalog = store.all("skus")
        if not catalog:
            raise HTTPException(422, "Cadastre um produto com foto antes de enviar o vídeo.")
        filename = Path(video.filename or "video.mp4").name
        suffix = Path(filename).suffix.lower()
        if suffix not in {".mp4", ".mov", ".m4v", ".avi", ".webm", ".mkv"}:
            raise HTTPException(422, "Envie um vídeo MP4, MOV, M4V, AVI, WebM ou MKV.")
        directory = media / uuid4().hex
        directory.mkdir()
        destination = directory / ("capture" + suffix)
        try:
            fingerprint = upload_file(video, destination, settings.max_upload_mb)
        except Exception:
            shutil.rmtree(directory, ignore_errors=True)
            raise
        record = {"id":uuid4().hex,"filename":filename,"source_path":str(destination),"video_sha256":fingerprint,
            "created_at":now(),"status":"processing","stage":"frames","error":None,"catalog":catalog,
            "synthetic":synthetic,"simulated":synthetic or settings.provider=="mock","model":settings.model,
            "frames":[],"primary_frame_id":None,"identification":None,"prediction":None,"results":[],
            "unknown_products":[],"confirmed_counts":None,"attempts":[],"processing_seconds":0}
        response = save(record)
        background_tasks.add_task(process,record["id"])
        return response

    @app.get("/api/videos/{identifier}")
    def video_detail(identifier: str):
        return public(get_video(identifier))

    @app.post("/api/videos/{identifier}/retry", status_code=202)
    def retry(identifier: str, background_tasks: BackgroundTasks):
        with mutation_lock:
            record = get_video(identifier)
            if record["status"] == "processing":
                raise HTTPException(409, "Este vídeo ainda está sendo analisado.")
            catalog = store.all("skus")
            if not catalog:
                raise HTTPException(422, "Cadastre um produto com foto antes de analisar novamente.")
            record.update(status="processing",stage="identifying" if record["frames"] else "frames",error=None,
                prediction=None,identification=None,results=[],unknown_products=[],confirmed_counts=None,
                catalog=catalog)
            response = save(record)
            background_tasks.add_task(process,identifier)
            return response

    @app.patch("/api/videos/{identifier}/counts")
    def correct(identifier: str, body: Correction):
        with mutation_lock:
            record = get_video(identifier)
            known = {r["sku_id"] for r in record["results"]}
            if record["status"] == "processing" or not known:
                raise HTTPException(409, "Aguarde um resultado antes de corrigir.")
            if set(body.counts) != known or any(q is not None and q < 0 for q in body.counts.values()):
                raise HTTPException(422, "Informe as quantidades dos produtos exibidos, com inteiros não negativos ou deixe em branco.")
            record["confirmed_counts"] = body.counts
            for result in record["results"]:
                result["confirmed_quantity"] = body.counts[result["sku_id"]]
            return save(record)

    @app.get("/api/videos/{identifier}/export")
    def export(identifier: str):
        record = get_video(identifier)
        return JSONResponse({"format_version":2,"video":public(record)},headers={"Content-Disposition":f'attachment; filename="contabot-{record["id"]}.json"'})

    app.mount("/static",StaticFiles(directory=static),name="static")
    app.mount("/media",StaticFiles(directory=media),name="media")
    return app
