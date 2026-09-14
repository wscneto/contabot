"""HTTP workflow tests use synthetic video and fake providers, never ChatGPT/API."""
import io
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from contabot.app import create_app
from contabot.config import Settings
from contabot.providers import ProviderError, ProviderResult
from scripts.generate_demo import generate


@pytest.fixture(scope="module")
def demo(tmp_path_factory):
    directory = tmp_path_factory.mktemp("synthetic-video")
    generate(directory)
    return directory


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path, provider="mock", max_frames=3))) as current:
        yield current


def photo(color="red"):
    image = io.BytesIO()
    Image.new("RGB", (100, 100), color).save(image, "JPEG")
    return image.getvalue()


def catalog(client):
    for sku in ("A", "B"):
        response = client.post("/api/skus", data={"id": sku, "name": "Caixa " + sku},
                               files={"photos": ("ref.jpg", photo(), "image/jpeg")})
        assert response.status_code == 201, response.text


def upload(client, demo):
    response = client.post("/api/videos", data={"synthetic": "true"},
                           files={"video": ("capture.mp4", (demo / "prateleira_simulada.mp4").read_bytes(), "video/mp4")})
    assert response.status_code == 202, response.text
    video_id = response.json()["id"]
    return client.get(f"/api/videos/{video_id}").json()


class FakeProvider:
    def __init__(self, statuses=None, quantities=None, incomplete=False):
        self.statuses = statuses or {"A": "present", "B": "present"}
        self.quantities = quantities or {"A": 3, "B": 2}
        self.incomplete = incomplete
        self.calls = []

    def identify(self, video, catalog, frames):
        self.calls.append(("identify", [sku["id"] for sku in catalog], [frame["id"] for frame in frames]))
        prediction = {"video_id": video["id"], "unknown_products": [], "matches": [
            {"sku_id": sku["id"], "status": self.statuses[sku["id"]],
             "evidence_frame_ids": [frames[0]["id"]] if self.statuses[sku["id"]] != "absent" else [],
             "reason": "Resposta sintética para testar o fluxo."} for sku in catalog]}
        return ProviderResult(prediction, {"input_tokens": 15}, "test-provider", True, "identify-test")

    def count(self, video, catalog, frames):
        self.calls.append(("count", [sku["id"] for sku in catalog], [frame["id"] for frame in frames]))
        prediction = {"video_id": video["id"], "coverage_complete": not self.incomplete,
                      "overlap_resolved": True, "unknown_products": [], "counts": [
            {"sku_id": sku["id"], "quantity": self.quantities.get(sku["id"]),
             "incomplete": self.incomplete, "needs_review": self.incomplete,
             "reason": "Visibilidade insuficiente." if self.incomplete else "",
             "evidence_frame_ids": [frames[0]["id"]]} for sku in catalog]}
        return ProviderResult(prediction, {"input_tokens": 30}, "test-provider", True, "count-test")


def test_catalog_needs_only_name_and_photo(client):
    response = client.post("/api/skus", data={"name": "Língua de gato 85 g"},
                           files={"photos": ("ref.jpg", photo(), "image/jpeg")})
    assert response.status_code == 201, response.text
    sku = response.json()
    assert sku["id"] and sku["name"] == "Língua de gato 85 g"
    assert len(client.get("/api/skus").json()) == 1
    for data, files in (({"name": "Sem foto"}, None), ({"name": "   "}, {"photos": ("ref.jpg", photo(), "image/jpeg")}),
                        ({"name": "Inválida"}, {"photos": ("ref.jpg", b"not an image", "image/jpeg")})):
        assert client.post("/api/skus", data=data, files=files).status_code == 422
    assert len(client.get("/api/skus").json()) == 1


def test_upload_automatically_identifies_then_counts_once(client, demo):
    catalog(client)
    provider = FakeProvider()
    client.app.state.provider = provider
    video = upload(client, demo)
    assert [call[0] for call in provider.calls] == ["identify", "count"]
    assert set(provider.calls[1][1]) == {"A", "B"}
    assert set(provider.calls[0][2]).issubset(provider.calls[1][2])
    assert 1 <= len(provider.calls[0][2]) <= 3
    assert len(video["frames"]) <= client.app.state.settings.max_count_frames
    assert video["primary_frame_id"] in {frame["id"] for frame in video["frames"]}
    assert {row["sku_id"]: row["quantity"] for row in video["results"]} == {"A": 3, "B": 2}
    assert video["simulated"] is True and video["synthetic"] is True
    assert video["processing_seconds"] >= 0
    assert len(client.get("/api/videos").json()) == 1
    assert client.get(video["frames"][0]["url"]).status_code == 200
    assert client.get("/media/../contabot.sqlite3").status_code == 404


def test_correction_preserves_original_without_reviewer_or_notes(client, demo):
    catalog(client)
    client.app.state.provider = FakeProvider()
    video = upload(client, demo)
    original = deepcopy(video["prediction"])
    response = client.patch(f"/api/videos/{video['id']}/counts", json={"counts": {"A": 4, "B": 2}})
    assert response.status_code == 200, response.text
    corrected = response.json()
    assert corrected["confirmed_counts"] == {"A": 4, "B": 2}
    assert corrected["prediction"] == original
    assert {row["sku_id"]: row["confirmed_quantity"] for row in corrected["results"]} == {"A": 4, "B": 2}
    exported = client.get(f"/api/videos/{video['id']}/export").json()
    assert exported["format_version"] == 2
    assert exported["video"]["prediction"] == original
    assert "api_key" not in str(exported)


@pytest.mark.parametrize("counts", [{"A": -1, "B": 2}, {"A": True, "B": 2},
                                   {"A": "3", "B": 2}, {"A": 3},
                                   {"A": 3, "B": 2, "UNKNOWN": 1}])
def test_invalid_corrections_rejected(client, demo, counts):
    catalog(client)
    client.app.state.provider = FakeProvider()
    video = upload(client, demo)
    response = client.patch(f"/api/videos/{video['id']}/counts", json={"counts": counts})
    assert response.status_code == 422, response.text


def test_null_stays_unknown_and_cannot_become_automatic_zero(client, demo):
    catalog(client)
    client.app.state.provider = FakeProvider(quantities={"A": None, "B": 2}, incomplete=True)
    video = upload(client, demo)
    assert video["status"] == "needs_review"
    assert next(row for row in video["results"] if row["sku_id"] == "A")["quantity"] is None
    response = client.patch(f"/api/videos/{video['id']}/counts", json={"counts": {"A": None, "B": 2}})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "needs_review"
    assert response.json()["prediction"]["coverage_complete"] is False


def test_all_absent_skips_count_and_does_not_claim_zero(client, demo):
    catalog(client)
    provider = FakeProvider(statuses={"A": "absent", "B": "absent"})
    client.app.state.provider = provider
    video = upload(client, demo)
    assert [call[0] for call in provider.calls] == ["identify"]
    assert video["status"] == "no_matches"
    assert video["prediction"] is None
    assert video["results"] == []


def test_uncertain_sku_is_sent_for_counting(client, demo):
    catalog(client)
    provider = FakeProvider(statuses={"A": "uncertain", "B": "absent"}, quantities={"A": None}, incomplete=True)
    client.app.state.provider = provider
    video = upload(client, demo)
    assert provider.calls[1][1] == ["A"]
    assert video["status"] == "needs_review"
    assert video["results"][0]["quantity"] is None


def test_unregistered_sku_in_provider_response_fails_closed(client, demo):
    catalog(client)
    class Unknown(FakeProvider):
        def count(self, *args):
            result = super().count(*args)
            result.prediction["counts"][0]["sku_id"] = "UNREGISTERED"
            return result
    client.app.state.provider = Unknown()
    video = upload(client, demo)
    assert video["status"] == "failed"
    assert video["prediction"] is None
    assert video["results"] == []


def test_failure_is_safe_retains_usage_and_can_retry(client, demo):
    catalog(client)
    class Broken(FakeProvider):
        def count(self, *args):
            raise ProviderError("Falha controlada. Tente novamente.", usage={"input_tokens": 123}, request_id="req_failed")
    client.app.state.provider = Broken()
    video = upload(client, demo)
    assert video["status"] == "failed"
    assert "Falha controlada" in video["error"]
    assert video["attempts"][-1]["usage"] == {"input_tokens": 123}
    assert video["attempts"][-1]["request_id"] == "req_failed"
    client.app.state.provider = FakeProvider()
    response = client.post(f"/api/videos/{video['id']}/retry")
    assert response.is_success, response.text
    recovered = client.get(f"/api/videos/{video['id']}").json()
    assert recovered["prediction"] is not None
    assert len(recovered["attempts"]) >= 4


def test_catalog_is_snapshotted_and_videos_have_no_cross_video_total(client, demo):
    catalog(client)
    client.app.state.provider = FakeProvider()
    first = upload(client, demo)
    second = upload(client, demo)
    assert first["id"] != second["id"]
    assert {row["sku_id"]: row["quantity"] for row in first["results"]} == {"A": 3, "B": 2}
    exported = client.get(f"/api/videos/{first['id']}/export").json()["video"]
    assert {sku["id"] for sku in exported["catalog"]} == {"A", "B"}
    assert exported["video_sha256"]
    assert "aggregate" not in exported and "totals" not in exported


def test_upload_without_catalog_or_bad_video_has_no_successful_count(client, demo):
    response = client.post("/api/videos", files={"video": ("x.mp4", b"invalid", "video/mp4")})
    assert response.status_code == 422
    catalog(client)
    response = client.post("/api/videos", files={"video": ("x.mp4", b"invalid", "video/mp4")})
    assert response.status_code in {202, 422}
    if response.status_code == 202:
        assert client.get(f"/api/videos/{response.json()['id']}").json()["status"] == "failed"


def test_config_never_returns_credentials_and_legacy_forms_removed(client):
    config = client.get("/api/config").json()
    assert config["simulated"] is True
    assert "api_key" not in config
    page = client.get("/").text
    for name in ("session-form", "reviewer", "boundary_note", "dataset_group", "review_seconds"):
        assert name not in page
    assert client.get("/api/videos/missing").status_code == 404


def test_unexpected_failure_does_not_expose_private_details(client, demo):
    catalog(client)
    class Broken(FakeProvider):
        def identify(self, *args):
            raise RuntimeError("secret-test-do-not-show")
    client.app.state.provider = Broken()
    video = upload(client, demo)
    assert video["status"] == "failed"
    assert "secret-test-do-not-show" not in str(video)


def test_catalog_batches_identification_but_never_sums_partial_counts(tmp_path, demo):
    with TestClient(create_app(Settings(data_dir=tmp_path, provider="mock", max_frames=1, max_images=3))) as client:
        catalog(client)
        response = client.post("/api/skus", data={"id": "C", "name": "Caixa C"},
                               files={"photos": ("ref.jpg", photo(), "image/jpeg")})
        assert response.status_code == 201
        provider = FakeProvider(statuses={"A": "present", "B": "present", "C": "present"})
        client.app.state.provider = provider
        video = upload(client, demo)
        assert [call[0] for call in provider.calls] == ["identify", "identify"]
        assert {sku for call in provider.calls for sku in call[1]} == {"A", "B", "C"}
        assert video["status"] == "failed"
        assert video["prediction"] is None and video["results"] == []
        assert "área menor" in video["error"]


def test_retry_recognizes_newly_registered_sku(client, demo):
    catalog(client)
    client.app.state.provider = FakeProvider(statuses={"A": "absent", "B": "absent"})
    video = upload(client, demo)
    assert video["status"] == "no_matches"
    assert {sku["id"] for sku in video["catalog"]} == {"A", "B"}
    response = client.post("/api/skus", data={"id": "C", "name": "Produto recém-cadastrado"},
                           files={"photos": ("ref.jpg", photo(), "image/jpeg")})
    assert response.status_code == 201
    provider = FakeProvider(statuses={"A": "absent", "B": "absent", "C": "present"}, quantities={"C": 1})
    client.app.state.provider = provider
    response = client.post(f"/api/videos/{video['id']}/retry")
    assert response.status_code == 202, response.text
    retried = client.get(f"/api/videos/{video['id']}").json()
    assert {sku["id"] for sku in retried["catalog"]} == {"A", "B", "C"}
    assert set(provider.calls[0][1]) == {"A", "B", "C"}
    assert provider.calls[1][1] == ["C"]
    assert [(row["sku_id"], row["quantity"]) for row in retried["results"]] == [("C", 1)]


def test_edit_sku_preserves_old_evidence_and_retry_uses_updated_reference(client, demo):
    catalog(client)
    client.app.state.provider = FakeProvider()
    video = upload(client, demo)
    original = next(sku for sku in video["catalog"] if sku["id"] == "A")
    original_reference = client.get(original["photos"][0]).content
    response = client.patch("/api/skus/A", data={"name": "Caixa A — referência corrigida"},
                            files={"photos": ("new.jpg", photo("blue"), "image/jpeg")})
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["id"] == "A"
    assert updated["name"] == "Caixa A — referência corrigida"
    assert updated["photos"] != original["photos"]
    assert client.get(updated["photos"][0]).content != original_reference
    assert client.get(original["photos"][0]).content == original_reference
    saved = client.get(f"/api/videos/{video['id']}").json()
    assert next(sku for sku in saved["catalog"] if sku["id"] == "A") == original
    assert saved["prediction"] == video["prediction"]

    class RecordsCatalog(FakeProvider):
        def identify(self, current, catalog, frames):
            self.catalog_seen = deepcopy(catalog)
            return super().identify(current, catalog, frames)

    provider = RecordsCatalog()
    client.app.state.provider = provider
    response = client.post(f"/api/videos/{video['id']}/retry")
    assert response.status_code == 202, response.text
    retried = client.get(f"/api/videos/{video['id']}").json()
    assert next(sku for sku in retried["catalog"] if sku["id"] == "A") == updated
    sent = next(sku for sku in provider.catalog_seen if sku["id"] == "A")
    assert sent["name"] == updated["name"]
    assert sent["photos"][0].endswith(updated["photos"][0].removeprefix("/media/"))
    assert client.get(original["photos"][0]).content == original_reference


def test_edit_sku_name_without_upload_keeps_photos(client):
    catalog(client)
    original = next(sku for sku in client.get("/api/skus").json() if sku["id"] == "A")
    response = client.patch("/api/skus/A", data={"name": "Novo nome"})
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Novo nome"
    assert response.json()["photos"] == original["photos"]
    assert len(client.get("/api/skus").json()) == 2


def test_delete_sku_preserves_historical_counts_and_reference_images(client, demo):
    catalog(client)
    client.app.state.provider = FakeProvider()
    video = upload(client, demo)
    corrected = client.patch(f"/api/videos/{video['id']}/counts", json={"counts": {"A": 4, "B": 2}}).json()
    reference = next(sku for sku in video["catalog"] if sku["id"] == "A")["photos"][0]
    image = client.get(reference).content

    response = client.delete("/api/skus/A")
    assert response.status_code == 204 and response.content == b""
    assert [sku["id"] for sku in client.get("/api/skus").json()] == ["B"]
    assert client.get(f"/api/videos/{video['id']}").json() == corrected
    assert client.get(f"/api/videos/{video['id']}/export").json()["video"] == corrected
    preserved = client.get(reference)
    assert preserved.status_code == 200 and preserved.content == image
    assert client.patch("/api/skus/A", data={"name": "Produto apagado"}).status_code == 404


def test_deleted_sku_is_excluded_from_new_uploads_and_retries(client, demo):
    catalog(client)
    provider = FakeProvider()
    client.app.state.provider = provider
    original = upload(client, demo)
    assert client.delete("/api/skus/A").status_code == 204
    provider.calls.clear()

    new_video = upload(client, demo)
    assert client.post(f"/api/videos/{original['id']}/retry").status_code == 202
    retried = client.get(f"/api/videos/{original['id']}").json()
    assert [(stage, skus) for stage, skus, _ in provider.calls] == [
        ("identify", ["B"]), ("count", ["B"]), ("identify", ["B"]), ("count", ["B"])]
    for result in (new_video, retried):
        assert [sku["id"] for sku in result["catalog"]] == ["B"]
        assert [row["sku_id"] for row in result["results"]] == ["B"]


def test_deleting_last_sku_blocks_analysis_without_erasing_saved_result(client, demo):
    catalog(client)
    provider = FakeProvider()
    client.app.state.provider = provider
    original = upload(client, demo)
    calls = deepcopy(provider.calls)
    assert client.delete("/api/skus/A").status_code == 204
    assert client.delete("/api/skus/B").status_code == 204
    assert client.get("/api/skus").json() == []

    assert client.post(f"/api/videos/{original['id']}/retry").status_code == 422
    assert client.post("/api/videos", files={"video": ("capture.mp4", b"unused", "video/mp4")}).status_code == 422
    assert client.get(f"/api/videos/{original['id']}").json() == original
    assert provider.calls == calls


def test_delete_unknown_sku_returns_not_found_without_affecting_catalog(client):
    catalog(client)
    before = client.get("/api/skus").json()
    assert client.delete("/api/skus/missing").status_code == 404
    assert client.get("/api/skus").json() == before
    assert client.delete("/api/skus/A").status_code == 204
    assert client.delete("/api/skus/A").status_code == 404
    assert [sku["id"] for sku in client.get("/api/skus").json()] == ["B"]


def test_count_uses_neighbor_angle_and_retains_positive_partial_result(tmp_path, monkeypatch):
    candidates = []
    for identifier, timestamp, color in (("front", 0, "red"), ("side", 2, "blue"), ("top", 4, "yellow"), ("context", 12, "green")):
        path = tmp_path / "media" / f"{identifier}.jpg"
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(photo(color))
        candidates.append({"id": identifier, "timestamp_seconds": timestamp, "path": str(path),
                           "metrics": {"quality": .99 if identifier == "front" else .75}, "warnings": [],
                           "selection_reason": "Fixture sintética, sem reconhecimento visual."})
    extractions = []
    def extract(*args, **kwargs):
        extractions.append(1)
        return {"candidates": deepcopy(candidates), "selected_frame_ids": ["front", "context"],
                "primary_frame_id": "front", "duration_seconds": 13, "criteria": {}}
    monkeypatch.setattr("contabot.app.extract_frames", extract)

    class SideCounter(FakeProvider):
        def count(self, video, catalog, frames):
            assert "side" in {f["id"] for f in frames}
            assert "side" not in video["identification_frame_ids"]
            response = super().count(video, catalog, frames)
            response.prediction.update(coverage_complete=False, overlap_resolved=False)
            for count in response.prediction["counts"]:
                count.update(quantity=4, incomplete=True, needs_review=True,
                             evidence_frame_ids=["side"], reason="Quatro caixas distinguíveis no ângulo lateral; contagem parcial.")
            return response

    with TestClient(create_app(Settings(data_dir=tmp_path, provider="mock", max_frames=2, max_count_frames=4))) as client:
        catalog(client)
        provider = SideCounter()
        client.app.state.provider = provider
        submitted = client.post("/api/videos", data={"synthetic": "true"}, files={"video": ("fixture.mp4", b"synthetic", "video/mp4")})
        assert submitted.status_code == 202
        identifier = submitted.json()["id"]
        result = client.get(f"/api/videos/{identifier}").json()
        assert result["status"] == "needs_review", result.get("error")
        assert all(r["quantity"] == 4 and r["incomplete"] and r["evidence_frame_ids"] == ["side"] for r in result["results"])
        assert set(result["counting_selection"]["counting_frame_ids"]) == {"front", "side", "top", "context"}
        assert "candidate_frames" not in result
        confirmed = client.patch(f"/api/videos/{identifier}/counts", json={"counts": {"A": 5, "B": 5}}).json()
        assert confirmed["prediction"] == result["prediction"]
        assert confirmed["status"] == "needs_review"
        assert client.post(f"/api/videos/{identifier}/retry").status_code == 202
        assert extractions == [1]
        assert [call[2] for call in provider.calls if call[0] == "identify"] == [["front", "context"], ["front", "context"]]
