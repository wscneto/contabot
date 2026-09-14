"""Bounded OpenCV frame selection; quality scores are uncalibrated heuristics.

Image similarity reduces redundant API input. It never identifies or deduplicates
physical products. Recognition anchors guide a second selection of nearby views
that may reveal box sides or tops; those heuristics never establish a quantity.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np


class VideoError(ValueError):
    """An invalid capture or unsupported video cannot be counted safely."""


def _number(value: object, default: float = 0.0) -> float:
    try:
        number = float(str(value))
        return number if math.isfinite(number) else default
    except (ValueError, TypeError):
        return default


def _probe(path: Path) -> dict:
    if not shutil.which("ffprobe"):
        raise VideoError("Instale FFmpeg (incluindo ffprobe) para ler o vídeo e sua orientação.")
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries",
                "stream=width,height,duration,avg_frame_rate,r_frame_rate,nb_frames,start_time:"
                "stream_tags=rotate:stream_side_data=rotation,displaymatrix:format=duration",
                "-of", "json", str(path.resolve()),
            ],
            capture_output=True, text=True, timeout=20, check=True,
        )
        data = json.loads(result.stdout)
        stream = data["streams"][0]
    except (subprocess.SubprocessError, OSError, ValueError, KeyError, IndexError) as exc:
        raise VideoError("Vídeo inválido, incompleto ou sem faixa de imagem legível.") from exc
    stream["duration"] = _number(stream.get("duration")) or _number(data.get("format", {}).get("duration"))
    return stream


def _rotation(stream: dict) -> int:
    # FFmpeg display matrices specify counterclockwise degrees. The legacy rotate
    # tag uses the same sign. OpenCV's automatic handling is disabled explicitly.
    rotation = _number(stream.get("tags", {}).get("rotate"))
    for side in stream.get("side_data_list", []):
        matrix_rows = [line.split(":", 1)[1].split() for line in side.get("displaymatrix", "").splitlines() if ":" in line]
        if len(matrix_rows) >= 2:
            a, b = map(int, matrix_rows[0][:2])
            c, d = map(int, matrix_rows[1][:2])
            if a * d - b * c < 0:
                raise VideoError("Vídeo com transformação espelhada: exporte na orientação correta e envie novamente.")
        if "rotation" in side:
            rotation = _number(side["rotation"])
            break
    if not math.isclose(rotation / 90, round(rotation / 90), abs_tol=0.001):
        raise VideoError("Orientação não ortogonal: exporte o vídeo na posição correta e envie novamente.")
    return int(round(rotation)) % 360


def _orient(frame: np.ndarray, degrees: int) -> np.ndarray:
    operations = {90: cv2.ROTATE_90_COUNTERCLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_CLOCKWISE}
    return cv2.rotate(frame, operations[degrees]) if degrees else frame


def _resize(frame: np.ndarray, maximum: int) -> np.ndarray:
    height, width = frame.shape[:2]
    if max(height, width) <= maximum:
        return frame
    ratio = maximum / max(height, width)
    return cv2.resize(frame, (max(1, round(width * ratio)), max(1, round(height * ratio))), interpolation=cv2.INTER_AREA)


def _quality(frame: np.ndarray, previous: np.ndarray | None) -> tuple[dict, list[str], np.ndarray]:
    working = _resize(frame, 960)
    gray = cv2.cvtColor(working, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (160, 90), interpolation=cv2.INTER_AREA)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    clipped = float(np.mean((gray <= 12) | (gray >= 244)))
    brightness = float(gray.mean() / 255)
    exposure = max(0.0, (1 - clipped) * (1 - abs(brightness - 0.5)))
    motion = float(np.mean(cv2.absdiff(small, previous)) / 255) if previous is not None else 0.0
    hsv = cv2.cvtColor(working, cv2.COLOR_BGR2HSV)
    glare = float(np.mean((hsv[:, :, 2] >= 245) & (hsv[:, :, 1] <= 35)))
    normalized_sharpness = min(1.0, math.log1p(sharpness) / math.log1p(1000))
    quality = 0.50 * normalized_sharpness + 0.30 * exposure + 0.10 * (1 - motion) + 0.10 * (1 - glare)
    warnings = []
    if sharpness < 60:
        warnings.append("Possível falta de nitidez; confira os rótulos.")
    if exposure < 0.55:
        warnings.append("Possível exposição inadequada ou áreas sem detalhe.")
    if motion > 0.12:
        warnings.append("Mudança visual rápida entre frames; confira movimento e borrão.")
    if glare > 0.08:
        warnings.append("Áreas claras podem ser reflexos ou partes brancas da embalagem.")
    return {key: round(value, 6) for key, value in {
        "sharpness": sharpness, "exposure": exposure, "motion": motion, "glare": glare, "quality": quality,
    }.items()}, warnings, small


def _similar(first: np.ndarray, second: np.ndarray) -> bool:
    # Intentionally conservative: color difference plus coarse luminance hash.
    difference = float(np.mean(cv2.absdiff(first, second)))
    a = cv2.resize(cv2.cvtColor(first, cv2.COLOR_BGR2GRAY), (9, 8))
    b = cv2.resize(cv2.cvtColor(second, cv2.COLOR_BGR2GRAY), (9, 8))
    hamming = int(np.count_nonzero((a[:, 1:] > a[:, :-1]) != (b[:, 1:] > b[:, :-1])))
    return difference <= 3.0 and hamming <= 3


def _select(candidates: list[dict], thumbnails: dict, maximum: int, duration: float) -> tuple[list[str], str]:
    count = min(maximum, len(candidates))
    selected: list[dict] = []
    for bin_index in range(count):
        pool = [candidate for candidate in candidates if min(count - 1, int(candidate["timestamp_seconds"] / max(duration, 0.001) * count)) == bin_index]
        for candidate in sorted(pool, key=lambda item: item["metrics"]["quality"], reverse=True):
            duplicate = next((item for item in selected if _similar(thumbnails[candidate["id"]], thumbnails[item["id"]])), None)
            if duplicate:
                candidate["selection_reason"] = f"Imagem quase idêntica a {duplicate['id']}; não identifica produtos repetidos."
                continue
            candidate["selection_reason"] = f"Melhor qualidade disponível na faixa temporal {bin_index + 1}/{count}, sem imagem quase idêntica já selecionada."
            selected.append(candidate)
            break
    # There is always a candidate in some bin. The primary is only a proposal.
    primary = max(selected, key=lambda item: item["metrics"]["quality"] - 0.08 * abs(item["timestamp_seconds"] / max(duration, 0.001) - 0.5))
    primary["selection_reason"] += " Principal sugerido por qualidade; outros ângulos podem revelar unidades adicionais."
    return [item["id"] for item in selected], primary["id"]


def select_counting_frames(
    candidates: list[dict],
    evidence_frame_ids: list[str],
    max_frames: int,
    *,
    context_seconds: float = 6.0,
) -> list[dict]:
    """Keep recognition anchors and sample the views immediately around them.

    A sharp front label is useful for recognition but may hide a row of boxes.
    Sample forward and backward in time before spending spare slots on additional
    local coverage. Image similarity only removes redundant input; this routine
    does not infer products, viewing angles, visibility, or physical counts.
    Returned dictionaries are copies, retaining paths, timestamps and metrics.
    """
    if isinstance(max_frames, bool) or not isinstance(max_frames, int) or not 1 <= max_frames <= 500:
        raise VideoError("Use entre 1 e 500 frames para conferir a contagem.")
    if not math.isfinite(context_seconds) or context_seconds <= 0:
        raise VideoError("A janela de contexto deve ser positiva e finita.")
    if not candidates:
        if evidence_frame_ids:
            raise VideoError("Frame de evidência não encontrado entre os candidatos.")
        return []
    ordered = sorted((dict(item) for item in candidates), key=lambda item: item["timestamp_seconds"])
    by_id = {item["id"]: item for item in ordered}
    if len(by_id) != len(ordered) or set(evidence_frame_ids) - set(by_id):
        raise VideoError("Frame de evidência desconhecido ou identificador de frame repetido.")
    anchors = [item for item in ordered if item["id"] in set(evidence_frame_ids)]
    selected: list[dict] = []
    thumbnails: dict[str, np.ndarray | None] = {}

    def thumbnail(item: dict) -> np.ndarray | None:
        if item["id"] not in thumbnails:
            path = Path(item.get("path", ""))
            frame = cv2.imread(str(path)) if path.is_file() else None
            thumbnails[item["id"]] = cv2.resize(frame, (160, 90), interpolation=cv2.INTER_AREA) if frame is not None else None
        return thumbnails[item["id"]]

    def append(item: dict, reason: str, *, anchor: bool = False) -> bool:
        if len(selected) >= max_frames or any(other["id"] == item["id"] for other in selected):
            return False
        if not anchor:
            small = thumbnail(item)
            if small is not None and any(
                (other_small := thumbnail(other)) is not None and _similar(small, other_small)
                for other in selected
            ):
                return False
        item["selection_reason"] = reason
        selected.append(item)
        return True

    def quality(item: dict) -> float:
        return max(0.0, min(1.0, _number(item.get("metrics", {}).get("quality"))))

    def around(target: float, pool: list[dict], reason: str) -> None:
        # A small quality preference can break close temporal ties, but cannot
        # replace a side view seconds later with the globally sharpest front.
        for item in sorted(pool, key=lambda item: (
            abs(item["timestamp_seconds"] - target) - 0.3 * quality(item),
            item["timestamp_seconds"],
        )):
            if append(item, reason):
                break

    if not anchors:
        for target in np.linspace(ordered[0]["timestamp_seconds"], ordered[-1]["timestamp_seconds"], min(max_frames, len(ordered))):
            around(float(target), ordered, "Cobertura temporal adicional; reconhecimento ainda sem frame de evidência específico.")
        return sorted(selected, key=lambda item: item["timestamp_seconds"])

    # If evidence alone exceeds the budget, spread the retained anchors over
    # their timeline; never silently exceed the provider's image allowance.
    indices = np.linspace(0, len(anchors) - 1, min(len(anchors), max_frames), dtype=int)
    for index in indices:
        append(anchors[index], "Evidência de reconhecimento preservada para comparar a embalagem nos outros ângulos.", anchor=True)
    local = [item for item in ordered if any(abs(item["timestamp_seconds"] - anchor["timestamp_seconds"]) <= context_seconds for anchor in anchors)]
    step = min(2.0, context_seconds)
    for distance in np.arange(step, context_seconds + step / 2, step):
        for direction in (1, -1):
            for anchor in anchors:
                target = max(ordered[0]["timestamp_seconds"], min(ordered[-1]["timestamp_seconds"], anchor["timestamp_seconds"] + direction * float(distance)))
                if any(abs(item["timestamp_seconds"] - target) < step / 2 for item in selected):
                    continue
                pool = [item for item in local if abs(item["timestamp_seconds"] - target) <= step / 2]
                around(target, pool, f"Complemento próximo de {target:.1f} s para conferir topo/laterais ao redor de {anchor['id']}; não comprova novas unidades.")
    # Use remaining slots for local temporal diversity instead of concentrating
    # all input on one sharp label. Near-identical complements are still omitted.
    remaining = [item for item in local if item["id"] not in {chosen["id"] for chosen in selected}]
    while remaining and len(selected) < max_frames:
        item = max(remaining, key=lambda item: (
            min(abs(item["timestamp_seconds"] - chosen["timestamp_seconds"]) for chosen in selected) + 0.3 * quality(item),
            item["timestamp_seconds"],
        ))
        remaining.remove(item)
        append(item, "Complemento com maior distância temporal local para conferir unidades encobertas na vista frontal.")
    return sorted(selected, key=lambda item: item["timestamp_seconds"])


def extract_frames(
    video_path: Path,
    output_dir: Path,
    *,
    sample_hz: float = 1.0,
    max_frames: int = 5,
    max_candidates: int = 120,
    max_duration_seconds: float = 180,
    max_dimension: int = 1920,
) -> dict:
    """Extract candidates once, sequentially, preserving decoder timestamps.

    Requires ffprobe and the OpenCV FFmpeg backend. Decode work is capped at
    120 seconds of wall time, 43,200 frames, 240 fps, and 36 megapixels/frame.
    Invalid timestamps are rejected instead of silently replacing VFR times
    with frame index / FPS. Output paths are absolute local JPEG paths.
    """
    video_path, output_dir = Path(video_path), Path(output_dir)
    if not video_path.is_file():
        raise VideoError("Arquivo de vídeo não encontrado.")
    if not math.isfinite(sample_hz) or not 0 < sample_hz <= 30:
        raise VideoError("Frequência de amostragem deve estar entre 0 e 30 frames por segundo.")
    if not 1 <= max_frames <= max_candidates <= 500:
        raise VideoError("Use 1 ≤ frames selecionados ≤ candidatos ≤ 500.")
    if not math.isfinite(max_duration_seconds) or not 0 < max_duration_seconds <= 600:
        raise VideoError("Duração máxima deve estar entre 0 e 600 segundos.")
    if not 320 <= max_dimension <= 4096:
        raise VideoError("Resolução máxima deve estar entre 320 e 4096 pixels.")

    stream = _probe(video_path)
    duration = stream["duration"]
    if duration <= 0:
        raise VideoError("O vídeo não informa duração válida; exporte uma nova cópia.")
    if duration > max_duration_seconds + 0.001:
        raise VideoError(f"Vídeo excede {max_duration_seconds:g} segundos. Filme uma seção menor.")
    width, height = int(stream.get("width", 0)), int(stream.get("height", 0))
    if width <= 0 or height <= 0 or width * height > 36_000_000:
        raise VideoError("Resolução do vídeo inválida ou acima do limite de 36 megapixels.")
    numerator, _, denominator = str(stream.get("avg_frame_rate", "0/1")).partition("/")
    fps = _number(numerator) / (_number(denominator) or 1)
    if not 0 < fps <= 240:
        raise VideoError("Taxa de frames inválida ou acima de 240 fps; exporte o vídeo a 30 fps.")
    rotation = _rotation(stream)
    expected_frames = int(_number(stream.get("nb_frames")))
    if expected_frames > 43_200:
        raise VideoError("Vídeo contém frames demais; grave uma seção mais curta.")

    cap = cv2.VideoCapture(str(video_path.resolve()), cv2.CAP_FFMPEG)
    if not cap.isOpened():
        raise VideoError("OpenCV não conseguiu abrir o vídeo. Verifique o codec ou exporte como MP4/H.264.")
    cap.set(cv2.CAP_PROP_ORIENTATION_AUTO, 0)
    if cap.get(cv2.CAP_PROP_ORIENTATION_AUTO) != 0:
        cap.release()
        raise VideoError("O decoder não permite controlar a orientação; atualize OpenCV ou exporte uma nova cópia.")
    output_dir.mkdir(parents=True, exist_ok=True)
    candidates: list[dict] = []
    thumbnails: dict[str, np.ndarray] = {}
    created: list[Path] = []
    interval = max(1 / sample_hz, duration / max(1, max_candidates - 1))
    next_sample = 0.0
    decoded = 0
    previous: np.ndarray | None = None
    first_timestamp: float | None = None
    last_timestamp = -1.0
    last_frame: np.ndarray | None = None
    last_previous: np.ndarray | None = None
    deadline = time.monotonic() + 120

    def save_candidate(frame: np.ndarray, timestamp: float, previous_gray: np.ndarray | None, reason: str) -> None:
        frame = _resize(frame, max_dimension)
        metrics, warnings, _ = _quality(frame, previous_gray)
        candidate_id = f"f{len(candidates) + 1:04d}"
        image_path = output_dir / f"{candidate_id}.jpg"
        if image_path.exists():
            raise VideoError("Pasta de frames já contém uma extração; use uma pasta nova.")
        if not cv2.imwrite(str(image_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 94]):
            raise VideoError("Não foi possível salvar um frame para conferência.")
        created.append(image_path)
        candidates.append({
            "id": candidate_id, "timestamp_seconds": round(timestamp, 6),
            "path": str(image_path.resolve()), "width": frame.shape[1], "height": frame.shape[0],
            "metrics": metrics, "warnings": warnings, "selection_reason": reason,
        })
        thumbnails[candidate_id] = cv2.resize(frame, (160, 90), interpolation=cv2.INTER_AREA)

    try:
        while True:
            if time.monotonic() > deadline:
                raise VideoError("Tempo de decodificação excedido. Envie um vídeo menor.")
            ok, frame = cap.read()
            if not ok:
                break
            decoded += 1
            if decoded > 43_200:
                raise VideoError("Limite de frames decodificados excedido. Envie uma seção menor.")
            raw_timestamp = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
            if not math.isfinite(raw_timestamp) or raw_timestamp < 0:
                raise VideoError("Timestamps ilegíveis; exporte uma nova cópia do vídeo.")
            if first_timestamp is None:
                first_timestamp = raw_timestamp
            timestamp = raw_timestamp - first_timestamp
            if timestamp <= last_timestamp:
                raise VideoError("Timestamps inconsistentes; exporte o vídeo com timestamps válidos.")
            if timestamp > max_duration_seconds + 1 / fps:
                raise VideoError("Duração real excede o limite permitido; filme uma seção menor.")
            last_timestamp = timestamp
            frame = _orient(frame, rotation)
            last_frame, last_previous = frame, previous
            small_gray = cv2.resize(cv2.cvtColor(_resize(frame, 320), cv2.COLOR_BGR2GRAY), (160, 90), interpolation=cv2.INTER_AREA)
            if timestamp + 0.000001 >= next_sample and len(candidates) < max_candidates:
                save_candidate(frame, timestamp, previous, "Candidato extraído para seleção automática por qualidade e cobertura temporal.")
                next_sample += interval
                if timestamp >= next_sample:
                    next_sample = (math.floor(timestamp / interval) + 1) * interval
            previous = small_gray
        if not candidates:
            raise VideoError("Nenhum frame legível encontrado no vídeo.")
        if expected_frames and decoded < expected_frames:
            raise VideoError("Vídeo incompleto: faltam frames declarados no arquivo. Envie outra captura.")
        if duration - (last_timestamp + 1 / fps) > max(0.3, 3 / fps):
            raise VideoError("O vídeo terminou antes da duração declarada; envie uma cópia completa.")
        if last_frame is not None and len(candidates) < max_candidates and last_timestamp - candidates[-1]["timestamp_seconds"] > 0.000001:
            save_candidate(last_frame, last_timestamp, last_previous, "Último frame legível preservado para incluir o fim da captura entre os candidatos.")
    except Exception:
        for image_path in created:
            image_path.unlink(missing_ok=True)
        raise
    finally:
        cap.release()

    selected, primary = _select(candidates, thumbnails, max_frames, duration)
    warnings = [
        "Qualidade, reflexo e cobertura temporal são heurísticas; não comprovam visibilidade de todas as unidades.",
        "Frames complementares podem repetir caixas. A seção terá uma única contagem, nunca a soma dos frames.",
        "A seleção automática não comprova cobertura integral. Filme uma área curta e confira o resultado.",
    ]
    if interval > 1 / sample_hz + 0.0001:
        warnings.append("Frequência reduzida para distribuir os candidatos por todo o vídeo dentro do limite configurado.")
    if min(candidates[0]["width"], candidates[0]["height"]) < 480:
        warnings.append("Vídeo de baixa resolução: confira se variantes e gramaturas estão legíveis.")
    return {
        "duration_seconds": round(duration, 6), "rotation_degrees": rotation,
        "width": candidates[0]["width"], "height": candidates[0]["height"],
        "candidates": candidates, "selected_frame_ids": selected, "primary_frame_id": primary,
        "warnings": warnings,
        "criteria": {
            "version": "opencv-temporal-v2", "sample_hz_requested": sample_hz,
            "sample_interval_seconds_effective": round(interval, 6), "max_candidates": max_candidates,
            "max_frames": max_frames, "max_dimension": max_dimension,
            "timestamp_source": "OpenCV/FFmpeg CAP_PROP_POS_MSEC; normalized to first decoded frame",
            "source_first_timestamp_seconds": first_timestamp,
            "rotation_source": "ffprobe display matrix or rotate tag; counterclockwise degrees",
            "decoded_frames": decoded,
            "last_decoded_timestamp_seconds": round(last_timestamp, 6),
            "endpoint_included": abs(candidates[-1]["timestamp_seconds"] - last_timestamp) < 0.000001,
            "selection": "Best quality per temporal bin, conservative near-identical image removal",
            "sharpness": "Laplacian variance at longest side <= 960 px; warning below 60",
            "exposure": "(1 - fraction(gray <= 12 or >= 244)) * (1 - abs(mean(gray)/255 - 0.5))",
            "motion": "Mean adjacent-frame grayscale difference / 255 at 160x90; warning above 0.12",
            "glare": "Fraction HSV V >= 245 and S <= 35; warning above 0.08 (white labels also trigger)",
            "quality": "0.50 * min(1, log1p(sharpness)/log1p(1000)) + 0.30 * exposure + 0.10 * (1-motion) + 0.10 * (1-glare)",
            "near_identical": "Color mean absolute difference <= 3/255 AND difference-hash Hamming distance <= 3/64",
            "physical_coverage_verified": False,
        },
    }
