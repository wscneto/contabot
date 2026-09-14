"""Optional offline evaluation of original per-video suggestions, without UI forms."""
import argparse
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

from .domain import validate_identification, validate_count


def _seconds(value, name):
    if value is None:
        return None
    if type(value) not in {int, float} or value < 0 or not math.isfinite(value):
        raise ValueError(f"{name} deve ser um número finito não negativo.")
    return value


def _metrics(rows):
    numeric = [row for row in rows if row["absolute_error"] is not None]
    return {
        "sku_video_pairs": len(rows),
        "exact_accuracy": sum(row["exact"] for row in rows) / len(rows) if rows else None,
        "mean_absolute_error_numeric_only": sum(row["absolute_error"] for row in numeric) / len(numeric) if numeric else None,
        "unknown_count": len(rows) - len(numeric),
        "incomplete_count": sum(row["incomplete"] for row in rows),
        "incomplete_rate": sum(row["incomplete"] for row in rows) / len(rows) if rows else None,
        "missed_error_count": sum(row["missed_error"] for row in rows),
        "identification_missed_present_count": sum(row["identification_missed_present"] for row in rows),
    }


def evaluate(exports: list[dict], truth: dict, split="evaluation") -> dict:
    """Evaluate all catalog SKUs, including omitted/failed/undetected results.

    One video is one sample scope. Frames and repeated inference attempts never
    create independent samples. Unknown or absent-only identification is not zero.
    """
    if split not in {"tuning", "evaluation"}:
        raise ValueError("Conjunto inválido: use tuning ou evaluation.")
    if any(item.get("format_version") != 2 or not isinstance(item.get("video"), dict) for item in exports):
        raise ValueError("Use exportações de vídeo no formato 2.")
    videos = [item["video"] for item in exports]
    references = truth.get("videos", [])
    by_id = {item["video_id"]: item for item in references}
    if len(by_id) != len(references) or len({video["id"] for video in videos}) != len(videos):
        raise ValueError("Vídeos repetidos nas exportações ou contagens físicas.")
    if set(by_id) != {video["id"] for video in videos}:
        raise ValueError("Forneça exatamente uma referência física por vídeo exportado.")
    groups, fingerprints = {}, {}
    for video in videos:
        verified = by_id[video["id"]]
        group = str(verified.get("dataset_group", "")).strip()
        part = verified.get("split")
        if not group or part not in {"tuning", "evaluation"}:
            raise ValueError("Informe dataset_group e split em cada referência física.")
        if group in groups and groups[group] != part:
            raise ValueError("Vazamento: mesmo grupo de captura em ajuste e avaliação final.")
        groups[group] = part
        fingerprint = video.get("video_sha256")
        if fingerprint:
            if fingerprint in fingerprints and fingerprints[fingerprint] != part:
                raise ValueError("Vazamento: mesmo vídeo em ajuste e avaliação final.")
            fingerprints[fingerprint] = part
        if verified.get("data_origin") not in {"real", "synthetic"}:
            raise ValueError("Informe data_origin real ou synthetic.")
        if video.get("synthetic") and verified["data_origin"] != "synthetic":
            raise ValueError("Uma captura sintética não pode ser avaliada como real.")
        if verified["data_origin"] == "real" and verified.get("verified_physical") is not True:
            raise ValueError("Dados reais exigem contagem física verificada, independente da sugestão.")

    rows, timing, api_usage, confusions = [], [], [], []
    annotated_videos = Counter()
    for video in videos:
        verified = by_id[video["id"]]
        if verified["split"] != split:
            continue
        sku_ids = [sku["id"] for sku in video.get("catalog", [])]
        if not sku_ids or len(set(sku_ids)) != len(sku_ids):
            raise ValueError("A exportação precisa preservar o catálogo sem SKUs duplicados.")
        actual = verified.get("counts", {})
        if set(actual) != set(sku_ids) or any(type(value) is not int or value < 0 for value in actual.values()):
            raise ValueError("Informe todos os SKUs do catálogo com contagens físicas inteiras não negativas.")
        frame_ids = [frame["id"] for frame in video.get("frames", [])]
        identification = video.get("identification")
        matches = {}
        if identification is not None:
            parsed = validate_identification(identification, video["id"], sku_ids, frame_ids)
            matches = {item.sku_id: item.status for item in parsed.matches}
        predicted = {}
        prediction = video.get("prediction")
        if prediction is not None:
            candidates = [sku for sku in sku_ids if matches.get(sku) in {"present", "uncertain"}]
            if not candidates:
                raise ValueError("Uma previsão precisa da identificação original dos SKUs candidatos.")
            parsed = validate_count(prediction, video["id"], candidates, frame_ids)
            predicted = {item.sku_id: item.model_dump() for item in parsed.counts}
        simulated = verified["data_origin"] == "synthetic" or video.get("simulated", True)
        for sku in sku_ids:
            count = predicted.get(sku)
            quantity = count["quantity"] if count else None
            incomplete = bool(not count or count["incomplete"] or not prediction["coverage_complete"] or not prediction["overlap_resolved"])
            review = bool(incomplete or count.get("needs_review", True))
            rows.append({
                "video_id": video["id"], "sku_id": sku, "dataset_group": verified["dataset_group"],
                "simulated": simulated, "suggested": quantity, "physical": actual[sku],
                "exact": quantity == actual[sku],
                "absolute_error": abs(quantity - actual[sku]) if quantity is not None else None,
                "incomplete": incomplete, "system_requested_review": review,
                "missed_error": quantity is not None and quantity != actual[sku] and not review,
                "identification_missed_present": actual[sku] > 0 and matches.get(sku) == "absent",
            })
        annotations = verified.get("confusions")
        if annotations is not None:
            if not isinstance(annotations, list):
                raise ValueError("Confusões devem ser uma lista; [] significa nenhuma troca observada.")
            annotated_videos["simulated" if simulated else "real"] += 1
            for item in annotations:
                if not isinstance(item, dict) or set(item) != {"predicted_sku_id", "actual_sku_id", "quantity"}:
                    raise ValueError("Anotação de confusão inválida.")
                if item["actual_sku_id"] not in set(sku_ids) | {"UNKNOWN"} or item["predicted_sku_id"] not in set(sku_ids) | {"UNKNOWN"}:
                    raise ValueError("SKU desconhecido em confusão; use UNKNOWN para produtos fora do catálogo.")
                if type(item["quantity"]) is not int or item["quantity"] <= 0:
                    raise ValueError("Confusão exige quantidade inteira positiva.")
                confusions.append(item | {"video_id": video["id"], "simulated": simulated})
        for attempt in video.get("attempts", []):
            api_usage.append({"video_id": video["id"], "stage": attempt.get("stage"),
                              "model": attempt.get("model"), "request_id": attempt.get("request_id"),
                              "status": attempt.get("status"), "usage": attempt.get("usage", {}),
                              "simulated": attempt.get("simulated", simulated)})
        capture = _seconds(verified.get("capture_seconds"), "capture_seconds")
        correction = _seconds(verified.get("correction_seconds"), "correction_seconds")
        manual = _seconds(verified.get("manual_seconds"), "manual_seconds")
        processing = _seconds(video.get("processing_seconds"), "processing_seconds")
        total = capture + correction + processing if all(value is not None for value in (capture, correction, processing)) else None
        confirmed = video.get("confirmed_counts") or {}
        complete = bool(predicted) and all(confirmed.get(sku) is not None for sku in predicted) and all(
            not row["incomplete"] for row in rows if row["video_id"] == video["id"])
        timing.append({"video_id": video["id"], "simulated": simulated, "capture_seconds": capture,
                       "processing_seconds": processing, "correction_seconds": correction,
                       "manual_seconds": manual, "total_seconds": total, "workflow_complete": complete,
                       "time_saved_seconds": manual - total if complete and manual is not None and total is not None else None})
    matrix = {}
    for group in ("real", "simulated"):
        counts = Counter()
        for item in confusions:
            if item["simulated"] == (group == "simulated"):
                counts[(item["actual_sku_id"], item["predicted_sku_id"])] += item["quantity"]
        matrix[group] = [{"actual_sku_id": pair[0], "predicted_sku_id": pair[1], "quantity": quantity}
                         for pair, quantity in sorted(counts.items())]
    return {"split": split, "notice": "Sem precisão operacional comprovada. Dados simulados ficam separados; frames não são amostras independentes.",
            "real": _metrics([row for row in rows if not row["simulated"]]),
            "simulated": _metrics([row for row in rows if row["simulated"]]),
            "rows": rows, "timing": timing, "api_usage": api_usage, "api_cost": None,
            "confusion_matrix": matrix, "confusion_annotated_videos": dict(annotated_videos)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exports", nargs="+", required=True, type=Path)
    parser.add_argument("--truth", required=True, type=Path)
    parser.add_argument("--split", choices=["tuning", "evaluation"], default="evaluation")
    parser.add_argument("--output", type=Path, default=Path("avaliacao.json"))
    args = parser.parse_args()
    try:
        report = evaluate([json.loads(path.read_text()) for path in args.exports], json.loads(args.truth.read_text()), args.split)
        report["input_sha256"] = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in [*args.exports, args.truth]}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, f"Avaliação inválida: {error}\n")
    print(f"Relatório salvo em {args.output}")


if __name__ == "__main__":
    main()
