#!/usr/bin/env python3
"""Create fictional reference photos and a video to exercise the upload flow.

This is a rendered scene, not field evaluation data. Each frame shows the same
three DEMO-A boxes and two DEMO-B boxes. Never add counts from several frames.
Run: uv run python scripts/generate_demo.py --output demo
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def box(image: np.ndarray, x: int, y: int, sku: str, scale: float = 1.0) -> None:
    width, height = round(155 * scale), round(230 * scale)
    color = (50, 55, 175) if sku == "DEMO-A" else (55, 165, 180)
    variant = "50 g" if sku == "DEMO-A" else "100 g"
    cv2.rectangle(image, (x + 9, y + 9), (x + width + 9, y + height + 9), (18, 18, 18), -1)
    cv2.rectangle(image, (x, y), (x + width, y + height), color, -1)
    cv2.rectangle(image, (x, y), (x + width, y + height), (210, 210, 210), 2)
    cv2.rectangle(image, (x, y), (x + width, y + round(35 * scale)), tuple(int(c * 0.7) for c in color), -1)
    cv2.putText(image, sku, (x + round(12 * scale), y + round(84 * scale)), cv2.FONT_HERSHEY_SIMPLEX, 0.68 * scale, (245, 245, 245), 2, cv2.LINE_AA)
    cv2.putText(image, "FICTICIO", (x + round(16 * scale), y + round(124 * scale)), cv2.FONT_HERSHEY_SIMPLEX, 0.52 * scale, (245, 245, 245), 1, cv2.LINE_AA)
    cv2.putText(image, variant, (x + round(36 * scale), y + round(175 * scale)), cv2.FONT_HERSHEY_SIMPLEX, 0.75 * scale, (245, 245, 245), 2, cv2.LINE_AA)


def generate(output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    for sku in ("DEMO-A", "DEMO-B"):
        reference = np.full((600, 600, 3), 65, np.uint8)
        box(reference, 168, 115, sku, 1.7)
        cv2.putText(reference, "REFERENCIA SIMULADA", (88, 555), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (245, 245, 245), 2, cv2.LINE_AA)
        if not cv2.imwrite(str(output / f"{sku}.jpg"), reference, [cv2.IMWRITE_JPEG_QUALITY, 95]):
            raise RuntimeError("Não foi possível salvar a referência simulada.")

    video = output / "prateleira_simulada.mp4"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"mp4v"), 15, (1280, 720))
    if not writer.isOpened():
        raise RuntimeError("Codec mp4v indisponível neste OpenCV.")
    try:
        for index in range(90):
            frame = np.full((720, 1280, 3), (42, 38, 35), np.uint8)
            # Slow pan, all five physical boxes stay fully visible throughout.
            offset = round(30 * np.sin(2 * np.pi * index / 90))
            cv2.rectangle(frame, (65 + offset, 165), (1215 + offset, 595), (90, 85, 80), 3)
            cv2.line(frame, (65 + offset, 525), (1215 + offset, 525), (185, 175, 165), 14)
            for position, sku in enumerate(("DEMO-A", "DEMO-A", "DEMO-A", "DEMO-B", "DEMO-B")):
                box(frame, 150 + offset + position * 195, 280, sku)
            cv2.putText(frame, "SIMULADO - NAO MEDE PRECISAO REAL", (145, 70), cv2.FONT_HERSHEY_SIMPLEX, 1.15, (100, 220, 245), 2, cv2.LINE_AA)
            cv2.putText(frame, "PRATELEIRA DEMO / SECAO 01", (325, 135), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (230, 230, 230), 2, cv2.LINE_AA)
            cv2.putText(frame, "Mesmas 5 caixas em todos os frames: A=3, B=2", (200, 645), cv2.FONT_HERSHEY_SIMPLEX, 0.90, (230, 230, 230), 2, cv2.LINE_AA)
            writer.write(frame)
    finally:
        writer.release()

    manifest = {
        "simulated": True,
        "warning": "Cena desenhada para demonstração de fluxo. Não é uma contagem física verificada e não sustenta alegações de precisão operacional.",
        "video": video.name,
        "duration_seconds": 6,
        "shelf": "Prateleira demo",
        "section": "Seção 01",
        "selected_skus": ["DEMO-A", "DEMO-B"],
        "skus": [
            {"id": "DEMO-A", "name": "Caixa fictícia A", "variant": "50 g", "reference_photo": "DEMO-A.jpg"},
            {"id": "DEMO-B", "name": "Caixa fictícia B", "variant": "100 g", "reference_photo": "DEMO-B.jpg"},
        ],
        "rendered_quantities": {"DEMO-A": 3, "DEMO-B": 2},
        "coverage": "Uma seção completa; as mesmas cinco caixas aparecem repetidamente, com leve movimento de câmera.",
        "evaluation_split": "synthetic_demo_only",
    }
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("demo"), help="Pasta de saída (padrão: demo)")
    args = parser.parse_args()
    generate(args.output)
    print(f"Demonstração SIMULADA criada em {args.output.resolve()}")
    print("Cadastre DEMO-A (50 g) e DEMO-B (100 g) com as fotos JPG e envie prateleira_simulada.mp4.")
    print("Quantidades desenhadas, uma seção: DEMO-A = 3; DEMO-B = 2. Não somar frames.")
    print("O provedor simulado pode devolver sugestões diferentes; corrija e confirme para exercitar a revisão.")
