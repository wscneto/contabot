"""Strict visual results for one video; overlapping frames are never added."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator


Quantity = Annotated[StrictInt, Field(ge=0)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SkuMatch(StrictModel):
    sku_id: str
    status: Literal["present", "absent", "uncertain"]
    evidence_frame_ids: list[str]
    reason: str

    @model_validator(mode="after")
    def consistent_match(self) -> SkuMatch:
        if not self.reason.strip():
            raise ValueError("A identificação precisa de um motivo.")
        if self.status == "present" and not self.evidence_frame_ids:
            raise ValueError("Um SKU identificado exige evidência.")
        return self


class Identification(StrictModel):
    video_id: str
    matches: list[SkuMatch]
    unknown_products: list[str]


class SkuCount(StrictModel):
    sku_id: str
    quantity: Quantity | None
    incomplete: bool
    needs_review: bool
    reason: str
    evidence_frame_ids: list[str]

    @model_validator(mode="after")
    def consistent_count(self) -> SkuCount:
        if self.quantity is None and not self.incomplete:
            raise ValueError("Quantidade desconhecida exige contagem incompleta.")
        if self.incomplete and not self.needs_review:
            raise ValueError("Contagem incompleta exige revisão.")
        if self.needs_review and not self.reason.strip():
            raise ValueError("A revisão precisa de um motivo.")
        if self.quantity is not None and not self.evidence_frame_ids:
            raise ValueError("Uma quantidade observada, inclusive zero, exige evidência.")
        return self


class CountResult(StrictModel):
    video_id: str
    coverage_complete: bool
    overlap_resolved: bool
    counts: list[SkuCount]
    unknown_products: list[str]

    @model_validator(mode="after")
    def consistent_video(self) -> CountResult:
        if not self.coverage_complete or not self.overlap_resolved:
            if any(not count.incomplete for count in self.counts):
                raise ValueError("Cobertura ou sobreposição pendente impede contagens completas.")
            if any(count.quantity == 0 for count in self.counts):
                raise ValueError("Sem visibilidade completa, ausência é desconhecida; use null, não zero.")
        if not self.overlap_resolved:
            # A single image cannot duplicate units across video frames. Its
            # positive count is a partial observation, never the video total.
            if any(count.quantity is not None and len(count.evidence_frame_ids) != 1 for count in self.counts):
                raise ValueError("Sobreposição não resolvida permite quantidade apenas em um único frame.")
        if self.unknown_products and self.counts and not any(count.needs_review for count in self.counts):
            raise ValueError("Produtos desconhecidos exigem revisão da identificação.")
        return self


def _validate_membership(result: Identification | CountResult, video_id: str, sku_ids: list[str], frame_ids: list[str]) -> None:
    if result.video_id != video_id:
        raise ValueError("O modelo respondeu para outro vídeo.")
    if not sku_ids or len(sku_ids) != len(set(sku_ids)):
        raise ValueError("Envie SKUs sem repetições.")
    if not frame_ids or len(frame_ids) != len(set(frame_ids)):
        raise ValueError("Envie frames sem repetições.")
    rows = result.matches if isinstance(result, Identification) else result.counts
    returned = [row.sku_id for row in rows]
    if len(returned) != len(set(returned)):
        raise ValueError("O modelo repetiu um SKU.")
    if set(returned) != set(sku_ids):
        raise ValueError("A resposta deve incluir exatamente os SKUs enviados.")
    for row in rows:
        if len(row.evidence_frame_ids) != len(set(row.evidence_frame_ids)):
            raise ValueError("Frames de evidência repetidos.")
        if not set(row.evidence_frame_ids).issubset(frame_ids):
            raise ValueError("A resposta usa um frame que não foi enviado.")


def validate_identification(payload: dict[str, Any], video_id: str, sku_ids: list[str], frame_ids: list[str]) -> Identification:
    result = Identification.model_validate(payload)
    _validate_membership(result, video_id, sku_ids, frame_ids)
    return result


def validate_count(payload: dict[str, Any], video_id: str, sku_ids: list[str], frame_ids: list[str]) -> CountResult:
    result = CountResult.model_validate(payload)
    _validate_membership(result, video_id, sku_ids, frame_ids)
    return result
