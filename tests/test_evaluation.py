from copy import deepcopy

import pytest

from contabot.evaluation import evaluate


def example(identifier="video-1", quantities=None, actual=None, *, synthetic=False, simulated=False, split="evaluation"):
    quantities = quantities or {"A": 3, "B": 2}
    actual = actual or {"A": 3, "B": 2}
    video = {
        "id": identifier, "catalog": [{"id": sku} for sku in actual], "video_sha256": identifier,
        "synthetic": synthetic, "simulated": simulated, "status": "completed",
        "frames": [{"id": "f1"}], "processing_seconds": 4,
        "identification": {"video_id": identifier, "unknown_products": [], "matches": [
            {"sku_id": sku, "status": "present", "evidence_frame_ids": ["f1"], "reason": "Observado"} for sku in actual]},
        "prediction": {"video_id": identifier, "coverage_complete": True, "overlap_resolved": True,
                       "unknown_products": [], "counts": [
            {"sku_id": sku, "quantity": quantity, "incomplete": quantity is None,
             "needs_review": quantity is None, "reason": "Incerto" if quantity is None else "",
             "evidence_frame_ids": ["f1"]} for sku, quantity in quantities.items()]},
        "confirmed_counts": deepcopy(actual),
        "attempts": [{"stage": "counting", "model": "test", "status": "success", "request_id": "req-1",
                      "usage": {"input_tokens": 100}, "simulated": simulated}],
    }
    reference = {"video_id": identifier, "data_origin": "synthetic" if synthetic else "real",
                 "verified_physical": not synthetic, "split": split, "dataset_group": identifier,
                 "counts": actual, "capture_seconds": 10, "correction_seconds": 5, "manual_seconds": 40}
    return {"format_version": 2, "video": video}, reference


def run(*cases, split="evaluation"):
    return evaluate([case[0] for case in cases], {"videos": [case[1] for case in cases]}, split)


def test_original_suggestion_compared_with_physical_counts():
    case = example(quantities={"A": 4, "B": 2})
    report = run(case)
    assert report["real"]["sku_video_pairs"] == 2
    assert report["real"]["exact_accuracy"] == 0.5
    assert report["real"]["mean_absolute_error_numeric_only"] == 0.5
    assert report["real"]["missed_error_count"] == 1
    assert case[0]["video"]["confirmed_counts"] == {"A": 3, "B": 2}
    assert report["rows"][0]["suggested"] == 4
    assert report["timing"][0]["time_saved_seconds"] == 21
    assert report["api_usage"][0]["usage"] == {"input_tokens": 100}
    assert report["api_cost"] is None


def test_unknown_and_failed_counts_remain_in_denominator():
    unknown = example(quantities={"A": None, "B": 2})
    failed = example("failed")
    failed[0]["video"].update(prediction=None, status="failed", confirmed_counts=None)
    report = run(unknown, failed)
    assert report["real"]["sku_video_pairs"] == 4
    assert report["real"]["unknown_count"] == 3
    assert report["real"]["incomplete_count"] == 3
    assert report["real"]["exact_accuracy"] == 0.25
    assert report["real"]["mean_absolute_error_numeric_only"] == 0
    assert all(timing["time_saved_seconds"] is None for timing in report["timing"])


def test_absent_identification_is_not_zero_and_missed_products_are_measured():
    case = example()
    video = case[0]["video"]
    video.update(prediction=None, confirmed_counts=None, status="no_matches")
    for match in video["identification"]["matches"]:
        match.update(status="absent", evidence_frame_ids=[])
    report = run(case)
    assert report["real"]["unknown_count"] == 2
    assert report["real"]["identification_missed_present_count"] == 2
    assert all(row["suggested"] is None for row in report["rows"])


def test_incomplete_numeric_predictions_do_not_earn_time_savings():
    case = example()
    case[0]["video"]["prediction"]["coverage_complete"] = False
    for count in case[0]["video"]["prediction"]["counts"]:
        count.update(incomplete=True, needs_review=True, reason="Nem todas as caixas são visíveis")
    report = run(case)
    assert report["real"]["incomplete_count"] == 2
    assert report["timing"][0]["time_saved_seconds"] is None


def test_single_frame_partial_count_with_unresolved_overlap_stays_incomplete():
    case = example(quantities={"A": 2, "B": 1})
    case[0]["video"]["prediction"].update(coverage_complete=False, overlap_resolved=False)
    for count in case[0]["video"]["prediction"]["counts"]:
        count.update(incomplete=True, needs_review=True, reason="Unidades visíveis em um único frame.")
    report = run(case)
    assert report["real"]["incomplete_count"] == 2
    assert report["real"]["unknown_count"] == 0
    assert report["real"]["mean_absolute_error_numeric_only"] == 1
    assert report["real"]["missed_error_count"] == 0
    assert report["timing"][0]["time_saved_seconds"] is None


def test_simulation_and_synthetic_images_stay_out_of_real_metrics():
    report = run(example("real"), example("mock", simulated=True), example("synthetic-api", synthetic=True))
    assert report["real"]["sku_video_pairs"] == 2
    assert report["simulated"]["sku_video_pairs"] == 4
    only_mock = run(example(simulated=True))
    assert only_mock["real"]["exact_accuracy"] is None


def test_synthetic_cannot_be_relabelled_real():
    case = example(synthetic=True)
    case[1].update(data_origin="real", verified_physical=True)
    with pytest.raises(ValueError, match="sintética"):
        run(case)


@pytest.mark.parametrize("field", ["dataset_group", "video_sha256"])
def test_adjustment_and_final_evaluation_must_not_share_capture(field):
    first = example("one", split="tuning")
    second = example("two", split="evaluation")
    if field == "dataset_group":
        first[1][field] = second[1][field] = "same-scene"
    else:
        first[0]["video"][field] = second[0]["video"][field] = "same-video"
    with pytest.raises(ValueError, match="Vazamento"):
        run(first, second)


def test_split_filters_whole_videos():
    report = run(example("adjustment", split="tuning"), example("final"))
    assert {row["video_id"] for row in report["rows"]} == {"final"}


@pytest.mark.parametrize("quantity", [-1, True, "3", 1.5, None])
def test_physical_counts_are_strict_nonnegative_integers(quantity):
    case = example()
    case[1]["counts"]["A"] = quantity
    with pytest.raises(ValueError, match="inteiras"):
        run(case)


def test_real_ground_truth_requires_physical_verification():
    case = example()
    case[1]["verified_physical"] = False
    with pytest.raises(ValueError, match="física"):
        run(case)


@pytest.mark.parametrize("change", ["unknown_sku", "boolean_count", "foreign_frame", "wrong_video"])
def test_invalid_model_exports_are_rejected(change):
    case = example()
    prediction = case[0]["video"]["prediction"]
    if change == "unknown_sku":
        prediction["counts"][0]["sku_id"] = "NOT-REGISTERED"
    elif change == "boolean_count":
        prediction["counts"][0]["quantity"] = True
    elif change == "foreign_frame":
        prediction["counts"][0]["evidence_frame_ids"] = ["not-from-video"]
    else:
        prediction["video_id"] = "wrong-video"
    with pytest.raises(ValueError):
        run(case)


def test_confusion_is_explicitly_annotated_and_partitioned():
    real = example()
    real[1]["confusions"] = [{"actual_sku_id": "B", "predicted_sku_id": "A", "quantity": 2}]
    synthetic = example("synthetic", synthetic=True)
    synthetic[1]["confusions"] = []
    report = run(real, synthetic)
    assert report["confusion_matrix"]["real"] == [{"actual_sku_id": "B", "predicted_sku_id": "A", "quantity": 2}]
    assert report["confusion_matrix"]["simulated"] == []
    assert report["confusion_annotated_videos"] == {"real": 1, "simulated": 1}


def test_missing_timing_is_not_invented_from_video_duration():
    case = example()
    case[1].pop("capture_seconds")
    case[0]["video"]["duration_seconds"] = 6
    timing = run(case)["timing"][0]
    assert timing["capture_seconds"] is None
    assert timing["total_seconds"] is None
    assert timing["time_saved_seconds"] is None


@pytest.mark.parametrize("value", [-1, float("nan"), float("inf"), True])
def test_invalid_timing_rejected(value):
    case = example()
    case[1]["correction_seconds"] = value
    with pytest.raises(ValueError, match="finito"):
        run(case)


def test_duplicate_export_does_not_create_independent_samples():
    case = example()
    with pytest.raises(ValueError, match="repetidos"):
        run(case, case)
