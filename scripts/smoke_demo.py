"""Run catalog → video → identification → count → correction with isolated mock data.

uv run python -m scripts.smoke_demo --output demo/smoke
No subscription/API call. Synthetic quantities do not establish real accuracy.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from contabot.app import create_app
from contabot.config import Settings
from contabot.evaluation import evaluate
from scripts.generate_demo import generate


def _request(client, method, path, **kwargs):
    response = client.request(method, path, **kwargs)
    if not response.is_success:
        raise RuntimeError(f"Demonstração falhou: {method} {path}: {response.status_code}: {response.text}")
    return response.json()


def run(output: Path) -> dict:
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="contabot-smoke-") as temporary:
        root = Path(temporary)
        capture = root / "capture"
        manifest = generate(capture)
        settings = Settings(data_dir=root / "data", provider="mock")
        with TestClient(create_app(settings)) as client:
            for sku in manifest["skus"]:
                _request(client, "POST", "/api/skus", data={"id": sku["id"], "name": sku["name"]},
                         files={"photos": (sku["reference_photo"], (capture / sku["reference_photo"]).read_bytes(), "image/jpeg")})
            created = _request(client, "POST", "/api/videos", data={"synthetic": "true"},
                               files={"video": (manifest["video"], (capture / manifest["video"]).read_bytes(), "video/mp4")})
            path = f"/api/videos/{created['id']}"
            video = _request(client, "GET", path)
            if not video["prediction"] or not video["simulated"]:
                raise RuntimeError("A demonstração exige uma contagem explicitamente simulada.")
            original = video["prediction"]
            corrected = _request(client, "PATCH", path + "/counts", json={"counts": manifest["rendered_quantities"]})
            if corrected["prediction"] != original or corrected["confirmed_counts"] != manifest["rendered_quantities"]:
                raise RuntimeError("A correção deve preservar a sugestão original.")
            exported = _request(client, "GET", path + "/export")
        truth = {"notice": "SIMULADO: valores desenhados e tempos fictícios; nenhuma contagem física humana.",
                 "videos": [{"video_id": video["id"], "dataset_group": "synthetic-demo", "split": "evaluation",
                             "data_origin": "synthetic", "verified_physical": False,
                             "counts": manifest["rendered_quantities"], "capture_seconds": 8,
                             "correction_seconds": 4, "manual_seconds": 30}]}
        report = evaluate([exported], truth)
        if report["real"]["sku_video_pairs"] != 0 or report["simulated"]["sku_video_pairs"] != 2:
            raise RuntimeError("Dados simulados não podem entrar nas métricas operacionais.")
        shutil.copytree(settings.data_dir / "media", output / "media", dirs_exist_ok=True)
        for filename, value in (("export.json", exported), ("truth.json", truth), ("evaluation.json", report)):
            (output / filename).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        (output / "README.txt").write_text(
            "SIMULADO — teste de software; não comprova precisão operacional.\n"
            "export.json: vídeo, identificação, sugestão original, correção, frames e uso do provedor.\n"
            "truth.json: quantidades desenhadas e tempos fictícios. evaluation.json: comparação somente simulada.\n"
            "media/: evidências preservadas; URLs /media/... são relativas a esta pasta.\n")
    return {"output": str(output), "confirmed_counts": corrected["confirmed_counts"], "simulated": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("demo/smoke"))
    args = parser.parse_args()
    print(json.dumps(run(args.output), ensure_ascii=False))
    print("Fluxo SIMULADO concluído. Nenhuma chamada externa ou alegação de precisão operacional.")
