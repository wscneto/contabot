"""Synthetic validation of video mechanics; this does not measure stock accuracy."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest

from contabot.video import VideoError, _quality, extract_frames, select_counting_frames


pytestmark = pytest.mark.skipif(not shutil.which("ffprobe"), reason="FFmpeg/ffprobe is a required system dependency")


def write_video(path: Path, frames: list[np.ndarray], fps: int = 10) -> Path:
    height, width = frames[0].shape[:2]
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    if not writer.isOpened():
        pytest.skip("OpenCV build lacks the mp4v video writer")
    for frame in frames:
        writer.write(frame)
    writer.release()
    return path


def scene(index: int = 0) -> np.ndarray:
    frame = np.full((240, 400, 3), (30 + 50 * index, 100, 150 - 50 * index), np.uint8)
    cv2.rectangle(frame, (40 + index * 70, 55), (120 + index * 70, 200), (210, 210, 210), 4)
    cv2.putText(frame, f"SIMULADO {index}", (25, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (240, 240, 240), 2)
    return frame


def test_temporal_coverage_is_preserved_instead_of_global_top_quality(tmp_path):
    video = write_video(tmp_path / "coverage.mp4", [scene(i // 20) for i in range(60)])
    result = extract_frames(video, tmp_path / "frames", sample_hz=2, max_frames=3)
    selected = [candidate for candidate in result["candidates"] if candidate["id"] in result["selected_frame_ids"]]
    assert len(selected) == 3
    assert {int(candidate["timestamp_seconds"] // 2) for candidate in selected} == {0, 1, 2}
    assert result["primary_frame_id"] in result["selected_frame_ids"]
    assert result["criteria"]["physical_coverage_verified"] is False
    assert all(Path(candidate["path"]).is_file() for candidate in selected)
    assert all("quality" in candidate["metrics"] for candidate in selected)


def test_near_identical_frames_reduce_input_without_claiming_product_dedup(tmp_path):
    video = write_video(tmp_path / "static.mp4", [scene()] * 40)
    result = extract_frames(video, tmp_path / "frames", sample_hz=2, max_frames=4)
    assert len(result["candidates"]) == 9  # Eight regular samples plus the capture endpoint.
    assert len(result["selected_frame_ids"]) == 1
    assert any("não identifica produtos" in candidate["selection_reason"] for candidate in result["candidates"])
    assert any("nunca a soma" in warning for warning in result["warnings"])


def test_candidate_cap_still_covers_late_video_and_timestamps_are_monotonic(tmp_path):
    video = write_video(tmp_path / "bounded.mp4", [scene(i // 20) for i in range(60)])
    result = extract_frames(video, tmp_path / "frames", sample_hz=20, max_candidates=4, max_frames=3)
    timestamps = [candidate["timestamp_seconds"] for candidate in result["candidates"]]
    assert len(timestamps) <= 4
    assert timestamps == sorted(set(timestamps))
    assert timestamps[-1] == pytest.approx(5.9)
    assert result["criteria"]["endpoint_included"] is True
    assert result["criteria"]["sample_interval_seconds_effective"] == 2
    assert any("Frequência reduzida" in warning for warning in result["warnings"])


def counting_candidates(tmp_path, timestamps, *, identical=False):
    candidates = []
    for index, timestamp in enumerate(timestamps):
        path = tmp_path / f"candidate-{index}.jpg"
        color = (35, 95, 150) if identical else (25 + index * 11, 50 + index * 9, 160 - index * 7)
        frame = np.full((90, 160, 3), color, np.uint8)
        cv2.imwrite(str(path), frame)
        candidates.append({
            "id": f"c{index}", "timestamp_seconds": timestamp, "path": str(path),
            "width": 160, "height": 90, "metrics": {"quality": 1 if index == 0 else 0.3},
            "selection_reason": "original", "warnings": [],
        })
    return candidates


def test_counting_keeps_less_sharp_later_views_instead_of_only_front(tmp_path):
    candidates = counting_candidates(tmp_path, [0, 1, 2, 3, 4, 5, 6, 12])
    selected = select_counting_frames(candidates, ["c0"], 3)
    assert [item["timestamp_seconds"] for item in selected] == [0, 2, 4]
    assert all(item["selection_reason"] == "original" for item in candidates)
    assert selected[1]["metrics"] == candidates[2]["metrics"]
    assert selected[1]["path"] == candidates[2]["path"]
    assert "topo/laterais" in selected[1]["selection_reason"]


def test_counting_neighbors_cover_before_and_after_recognition(tmp_path):
    candidates = counting_candidates(tmp_path, list(range(13)))
    selected = select_counting_frames(candidates, ["c6"], 5)
    assert [item["timestamp_seconds"] for item in selected] == [2, 4, 6, 8, 10]


def test_counting_near_clip_end_includes_lateral_view_and_endpoint(tmp_path):
    candidates = counting_candidates(tmp_path, [57, 59, 61, 63, 65, 67, 68, 68.9])
    selected = select_counting_frames(candidates, ["c3"], 6)
    assert [item["timestamp_seconds"] for item in selected] == [59, 61, 63, 65, 67, 68.9]


def test_counting_deduplicates_identical_complements_but_preserves_evidence(tmp_path):
    candidates = counting_candidates(tmp_path, [0, 1, 2, 3, 4], identical=True)
    selected = select_counting_frames(candidates, ["c0", "c2"], 5)
    assert [item["id"] for item in selected] == ["c0", "c2"]


def test_counting_budget_and_local_window_are_hard_limits(tmp_path):
    candidates = counting_candidates(tmp_path, [0, 2, 4, 6, 12])
    selected = select_counting_frames(candidates, ["c0"], 10)
    assert [item["timestamp_seconds"] for item in selected] == [0, 2, 4, 6]
    limited = select_counting_frames(candidates, ["c0", "c2", "c4"], 2)
    assert [item["id"] for item in limited] == ["c0", "c4"]


def test_counting_without_evidence_keeps_temporal_coverage(tmp_path):
    candidates = counting_candidates(tmp_path, list(range(11)))
    selected = select_counting_frames(candidates, [], 3)
    assert [item["timestamp_seconds"] for item in selected] == [0, 5, 10]
    assert select_counting_frames([], [], 3) == []


def test_counting_rejects_unknown_evidence_and_invalid_limits(tmp_path):
    candidates = counting_candidates(tmp_path, [0, 2])
    with pytest.raises(VideoError, match="desconhecido"):
        select_counting_frames(candidates, ["not-a-frame"], 3)
    with pytest.raises(VideoError, match="não encontrado"):
        select_counting_frames([], ["not-a-frame"], 3)
    for maximum in (0, 501, True, 1.5):
        with pytest.raises(VideoError, match="frames"):
            select_counting_frames(candidates, [], maximum)
    with pytest.raises(VideoError, match="janela"):
        select_counting_frames(candidates, [], 3, context_seconds=float("nan"))


def test_quality_heuristics_detect_blur_and_bright_areas():
    sharp = scene()
    blurred = cv2.GaussianBlur(sharp, (25, 25), 8)
    original_metrics, _, _ = _quality(sharp, None)
    blurred_metrics, _, _ = _quality(blurred, None)
    assert original_metrics["sharpness"] > blurred_metrics["sharpness"] * 3
    metrics, warnings, _ = _quality(np.full_like(sharp, 255), None)
    assert metrics["glare"] == 1
    assert metrics["exposure"] == 0
    assert any("reflexos" in warning for warning in warnings)


def test_invalid_video_and_excessive_duration_are_rejected(tmp_path):
    invalid = tmp_path / "invalid.mp4"
    invalid.write_bytes(b"not a video")
    with pytest.raises(VideoError, match="inválido"):
        extract_frames(invalid, tmp_path / "bad")
    video = write_video(tmp_path / "long.mp4", [scene()] * 20)
    with pytest.raises(VideoError, match="excede"):
        extract_frames(video, tmp_path / "long", max_duration_seconds=1)
    assert not (tmp_path / "long").exists()


def test_truncated_capture_is_rejected_and_leaves_no_candidate_images(tmp_path):
    source = write_video(tmp_path / "source.mp4", [scene(i // 20) for i in range(60)])
    # Truncating an MP4 normally removes its metadata; either opening or decoding
    # must fail. No partial candidates may become a successful result.
    truncated = tmp_path / "truncated.mp4"
    data = source.read_bytes()
    truncated.write_bytes(data[: len(data) // 2])
    with pytest.raises(VideoError):
        extract_frames(truncated, tmp_path / "frames")
    assert not list((tmp_path / "frames").glob("*.jpg"))


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg required to produce rotation metadata")
@pytest.mark.parametrize("rotation", [90, 180, 270])
def test_rotation_metadata_matches_ffmpeg_display_orientation(tmp_path, rotation):
    source = write_video(tmp_path / "source.mp4", [scene()] * 10)
    rotated = tmp_path / "rotated.mp4"
    metadata = subprocess.run(["ffmpeg", "-v", "error", "-display_rotation", str(rotation), "-i", str(source), "-c", "copy", str(rotated)], capture_output=True)
    if metadata.returncode:
        # The explicit input option was added in FFmpeg 6. Older supported
        # installations write the same display matrix through the rotate tag.
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-c", "copy", "-metadata:s:v:0", f"rotate={rotation}", str(rotated)], check=True, capture_output=True)
    expected_path = tmp_path / "expected.png"
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(rotated), "-frames:v", "1", str(expected_path)], check=True, capture_output=True)
    result = extract_frames(rotated, tmp_path / "frames", max_frames=1)
    actual = cv2.imread(result["candidates"][0]["path"])
    expected = cv2.imread(str(expected_path))
    assert actual.shape == expected.shape
    assert float(np.mean(cv2.absdiff(actual, expected))) < 4
    assert result["rotation_degrees"] == rotation


def test_resolution_is_preserved_below_cap_and_invalid_options_are_rejected(tmp_path):
    video = write_video(tmp_path / "video.mp4", [scene()] * 10)
    result = extract_frames(video, tmp_path / "frames")
    assert (result["width"], result["height"]) == (400, 240)
    with pytest.raises(VideoError, match="Frequência"):
        extract_frames(video, tmp_path / "invalid", sample_hz=0)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg required to produce variable-rate timestamps")
def test_variable_frame_rate_preserves_decoded_presentation_times(tmp_path):
    import json

    listing = []
    for index, duration in enumerate((0.12, 0.20, 0.60, 0.40)):
        path = tmp_path / f"image{index}.png"
        cv2.imwrite(str(path), scene(index % 3))
        listing.extend([f"file '{path}'", f"duration {duration}"])
    listing.append(f"file '{path}'")
    concat = tmp_path / "input.txt"
    concat.write_text("\n".join(listing) + "\n")
    video = tmp_path / "vfr.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(concat), "-fps_mode", "vfr", "-c:v", "mpeg4", str(video)], check=True, capture_output=True)
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", str(video)], check=True, capture_output=True, text=True)
    expected = [float(frame["best_effort_timestamp_time"]) for frame in json.loads(probe.stdout)["frames"]]
    result = extract_frames(video, tmp_path / "frames", sample_hz=30)
    actual = [candidate["timestamp_seconds"] for candidate in result["candidates"]]
    assert actual == pytest.approx(expected, abs=0.001)
    assert len({round(b - a, 2) for a, b in zip(actual, actual[1:])}) > 1
