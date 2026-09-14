"""Synthetic contract tests, not measurements of visual accuracy."""

from copy import deepcopy

import pytest

from contabot.domain import validate_count, validate_identification


def suggestion(quantity=3):
    return {"video_id": "video-1", "coverage_complete": True, "overlap_resolved": True,
            "unknown_products": [], "counts": [{"sku_id": "sku-a", "quantity": quantity,
            "incomplete": False, "needs_review": False, "reason": "",
            "evidence_frame_ids": ["frame-1", "frame-2"]}]}


def identification():
    return {"video_id": "video-1", "matches": [{"sku_id": "sku-a", "status": "present",
            "reason": "Rótulo visível.", "evidence_frame_ids": ["frame-1"]}], "unknown_products": []}


def validate(payload):
    return validate_count(payload, "video-1", ["sku-a"], ["frame-1", "frame-2"])


@pytest.mark.parametrize("quantity", [-1, 1.5, "3", True, False])
def test_quantity_requires_strict_nonnegative_integer(quantity):
    with pytest.raises(ValueError):
        validate(suggestion(quantity))


def test_multiple_frames_produce_one_quantity_without_summing_evidence():
    payload = suggestion(3)
    assert validate(payload).counts[0].quantity == 3
    payload["counts"].append(deepcopy(payload["counts"][0]))
    with pytest.raises(ValueError, match="repetiu"):
        validate(payload)


def test_zero_requires_complete_visibility_and_evidence():
    assert validate(suggestion(0)).counts[0].quantity == 0
    payload = suggestion(0)
    payload["counts"][0]["evidence_frame_ids"] = []
    with pytest.raises(ValueError, match="evidência"):
        validate(payload)
    payload = suggestion(0)
    payload["coverage_complete"] = False
    payload["counts"][0].update(incomplete=True, needs_review=True, reason="Área cortada.")
    with pytest.raises(ValueError, match="não zero"):
        validate(payload)


def test_pending_unknown_quantity_is_not_converted_to_zero():
    payload = suggestion(None)
    with pytest.raises(ValueError):
        validate(payload)
    payload["coverage_complete"] = False
    payload["counts"][0].update(incomplete=True, needs_review=True, reason="Caixas ocultas.")
    assert validate(payload).counts[0].quantity is None


def test_unresolved_overlap_cannot_return_a_duplicated_quantity():
    payload = suggestion(5)
    payload["overlap_resolved"] = False
    payload["counts"][0].update(incomplete=True, needs_review=True, reason="Mesmas caixas em ângulos diferentes.")
    with pytest.raises(ValueError, match="Sobreposição"):
        validate(payload)
    payload["counts"][0]["quantity"] = None
    assert validate(payload).counts[0].quantity is None


def test_incomplete_video_can_preserve_units_visible_in_one_side_frame():
    payload = suggestion(4)
    payload.update(coverage_complete=False, overlap_resolved=False)
    payload["counts"][0].update(
        incomplete=True, needs_review=True,
        reason="Quatro caixas separáveis na vista lateral; contagem parcial deste frame.",
        evidence_frame_ids=["frame-2"],
    )
    result = validate(payload)
    assert result.counts[0].quantity == 4
    assert result.counts[0].evidence_frame_ids == ["frame-2"]
    assert result.counts[0].incomplete and result.counts[0].needs_review
    assert not result.coverage_complete and not result.overlap_resolved


@pytest.mark.parametrize("change", [
    {"evidence_frame_ids": []}, {"evidence_frame_ids": ["frame-1", "frame-2"]},
    {"incomplete": False}, {"needs_review": False}, {"quantity": 0},
])
def test_single_frame_fallback_cannot_be_a_combined_or_complete_video_count(change):
    payload = suggestion(4)
    payload.update(coverage_complete=False, overlap_resolved=False)
    payload["counts"][0].update(incomplete=True, needs_review=True,
        reason="Unidades visíveis em um único frame; total desconhecido.", evidence_frame_ids=["frame-2"])
    payload["counts"][0].update(change)
    with pytest.raises(ValueError):
        validate(payload)


@pytest.mark.parametrize("change", [
    {"sku_id": "unknown-sku"}, {"evidence_frame_ids": ["unsent-frame"]},
    {"evidence_frame_ids": ["frame-1", "frame-1"]}, {"confidence": .99},
    {"needs_review": True, "reason": " "}, {"incomplete": True, "needs_review": False},
])
def test_invalid_count_responses_fail_closed(change):
    payload = suggestion()
    payload["counts"][0].update(change)
    with pytest.raises(ValueError):
        validate(payload)


@pytest.mark.parametrize("change", [
    {"video_id": "other-video"}, {"coverage_complete": False},
    {"overlap_resolved": False}, {"coverage_complete": "true"}, {"extra": "bad"},
    {"counts": []},
])
def test_invalid_video_results_fail_closed(change):
    payload = suggestion()
    payload.update(change)
    with pytest.raises(ValueError):
        validate(payload)


def test_unknown_products_remain_separate_and_trigger_review():
    payload = suggestion()
    payload["unknown_products"] = ["Caixa azul sem rótulo legível"]
    with pytest.raises(ValueError, match="desconhecidos exigem revisão"):
        validate(payload)
    payload["counts"][0].update(needs_review=True, reason="Conferir variante da caixa azul.")
    result = validate(payload)
    assert result.unknown_products == payload["unknown_products"]
    assert [count.sku_id for count in result.counts] == ["sku-a"]


@pytest.mark.parametrize("change", [
    {"sku_id": "unknown"}, {"status": "maybe"}, {"status": True},
    {"reason": ""}, {"evidence_frame_ids": []},
    {"evidence_frame_ids": ["missing"]}, {"evidence_frame_ids": ["frame-1", "frame-1"]},
])
def test_identification_rejects_unknown_skus_and_false_certainty(change):
    payload = identification()
    payload["matches"][0].update(change)
    with pytest.raises(ValueError):
        validate_identification(payload, "video-1", ["sku-a"], ["frame-1"])


def test_identification_requires_every_catalog_sku_once_and_preserves_uncertainty():
    payload = identification()
    payload["matches"][0].update(status="uncertain", evidence_frame_ids=[], reason="Rótulo ilegível.")
    assert validate_identification(payload, "video-1", ["sku-a"], ["frame-1"]).matches[0].status == "uncertain"
    with pytest.raises(ValueError, match="exatamente"):
        validate_identification(payload, "video-1", ["sku-a", "sku-b"], ["frame-1"])
    payload["matches"].append(deepcopy(payload["matches"][0]))
    with pytest.raises(ValueError, match="repetiu"):
        validate_identification(payload, "video-1", ["sku-a"], ["frame-1"])
