"""Mocked transport/CLI contracts; these tests never call a real model."""

import json
import subprocess
from pathlib import Path

import httpx
import pytest

from contabot.providers import CodexProvider, MockProvider, ProviderError, ResponsesProvider


@pytest.fixture
def inputs(tmp_path):
    photo = tmp_path / "reference.jpg"
    photo.write_bytes(b"synthetic-image-payload")
    detail = tmp_path / "detail.jpg"
    detail.write_bytes(b"synthetic-detail-payload")
    frames = [{"id": "frame-detail", "path": str(detail), "timestamp_seconds": 1.5},
              {"id": "frame-main", "path": str(photo), "timestamp_seconds": .5}]
    catalog = [{"id": "sku-a", "name": "Caixa", "variant": "100 g", "photos": [str(photo)]}]
    return {"id": "video-1", "primary_frame_id": "frame-main"}, catalog, frames


def prediction(stage="count"):
    if stage == "identify":
        return {"video_id": "video-1", "matches": [{"sku_id": "sku-a", "status": "present",
                "evidence_frame_ids": ["frame-main"], "reason": "Rótulo legível."}], "unknown_products": []}
    return {"video_id": "video-1", "coverage_complete": True, "overlap_resolved": True,
            "unknown_products": [], "counts": [{"sku_id": "sku-a", "quantity": 2,
            "incomplete": False, "evidence_frame_ids": ["frame-main"], "needs_review": False, "reason": ""}]}


def envelope(payload=None):
    return {"id": "resp-1", "status": "completed", "model": "configured-model",
            "usage": {"input_tokens": 153, "output_tokens": 74, "total_tokens": 227},
            "output": [{"type": "message", "status": "completed", "content": [
            {"type": "output_text", "text": json.dumps(prediction() if payload is None else payload)}]}]}


def provider(handler, **kwargs):
    return ResponsesProvider("configured-model", "https://visual.example/v1/responses", "test-secret",
                             transport=httpx.MockTransport(handler), **kwargs)


@pytest.mark.parametrize("stage", ["identify", "count"])
def test_api_sends_primary_complements_references_and_stage_schema(inputs, stage):
    captured = {}

    def handler(request):
        captured.update(json.loads(request.content))
        assert request.headers["authorization"] == "Bearer test-secret"
        return httpx.Response(200, json=envelope(prediction(stage)), headers={"x-request-id": "req-actual"})

    result = getattr(provider(handler, max_images=3, extra_parameters={"temperature": 0}), stage)(*inputs)
    assert captured["temperature"] == 0
    assert captured["store"] is False
    schema = captured["text"]["format"]
    assert schema["strict"] is True and schema["name"] == stage
    assert schema["schema"]["additionalProperties"] is False
    content = captured["input"][0]["content"]
    labels = [item["text"] for item in content if item["type"] == "input_text"]
    assert "PRINCIPAL" in labels[1] and "frame-main" in labels[1]
    assert "COMPLEMENTAR" in labels[2] and "frame-detail" in labels[2]
    assert "REFERÊNCIA" in labels[3] and "sku-a" in labels[3]
    images = [item for item in content if item["type"] == "input_image"]
    assert len(images) == 3
    assert all(item["detail"] == "high" for item in images)
    assert result.usage["total_tokens"] == 227 and result.request_id == "req-actual"
    assert result.simulated is False and result.prediction == prediction(stage)


@pytest.mark.parametrize("provider_name", ["codex", "responses"])
def test_image_limit_includes_references_before_inference(inputs, monkeypatch, provider_name):
    def unexpected(*args, **kwargs):
        pytest.fail("No inference should start above the configured image limit")

    monkeypatch.setattr(subprocess, "run", unexpected)
    visual = CodexProvider("configured-model", max_images=2) if provider_name == "codex" else provider(unexpected, max_images=2)
    with pytest.raises(ProviderError, match="3 imagens"):
        visual.identify(*inputs)


@pytest.mark.parametrize("bad_quantity", ["2", True, -3])
def test_api_rejects_invalid_quantities_preserving_usage(inputs, bad_quantity):
    invalid = prediction()
    invalid["counts"][0]["quantity"] = bad_quantity
    with pytest.raises(ProviderError, match="viola o esquema") as error:
        provider(lambda _: httpx.Response(200, json=envelope(invalid))).count(*inputs)
    assert error.value.usage["total_tokens"] == 227 and error.value.request_id == "resp-1"


@pytest.mark.parametrize("stage", ["identify", "count"])
def test_api_rejects_unknown_sku_without_coercion(inputs, stage):
    invalid = prediction(stage)
    invalid["matches" if stage == "identify" else "counts"][0]["sku_id"] = "unselected"
    with pytest.raises(ProviderError):
        getattr(provider(lambda _: httpx.Response(200, json=envelope(invalid))), stage)(*inputs)


@pytest.mark.parametrize("failure", ["refusal", "incomplete", "failed", "invalid-json", "empty", "multiple", "http-error"])
def test_api_failures_never_fall_back_to_synthetic_success(inputs, failure):
    data, status = envelope(), 200
    if failure == "refusal":
        data["output"][0]["content"] = [{"type": "refusal", "refusal": "test-secret"}]
    elif failure in {"incomplete", "failed"}:
        data["status"] = failure
    elif failure == "invalid-json":
        data["output"][0]["content"][0]["text"] = "not json"
    elif failure == "empty":
        data["output"] = []
    elif failure == "multiple":
        data["output"] *= 2
    elif failure == "http-error":
        status = 429
        data["error"] = {"message": "Rate limited test-secret"}
    with pytest.raises(ProviderError) as error:
        provider(lambda _: httpx.Response(status, json=data)).count(*inputs)
    assert error.value.usage["total_tokens"] == 227
    assert "test-secret" not in str(error.value)


def test_api_connection_error_does_not_expose_secret(inputs):
    def handler(request):
        raise httpx.ReadTimeout("test-secret", request=request)

    with pytest.raises(ProviderError, match="Falha de conexão") as error:
        provider(handler).count(*inputs)
    assert "test-secret" not in str(error.value)


def test_api_key_is_separate_from_chatgpt_and_local_endpoint_can_skip_key(inputs):
    with pytest.raises(ProviderError, match="Credencial ausente"):
        ResponsesProvider("configured-model", "https://api.openai.com/v1/responses", "").count(*inputs)

    def handler(request):
        assert "authorization" not in request.headers
        return httpx.Response(200, json=envelope())

    visual = ResponsesProvider("local-model", "http://127.0.0.1:8001/v1/responses", "", transport=httpx.MockTransport(handler))
    assert visual.count(*inputs).simulated is False


@pytest.mark.parametrize("parameter", ["store", "text", "input", "instructions", "model", "stream", "background"])
def test_api_parameters_cannot_override_counting_contract(parameter):
    with pytest.raises(ProviderError):
        provider(lambda _: None, extra_parameters={parameter: True})


@pytest.mark.parametrize("stage", ["identify", "count"])
def test_codex_reuses_chatgpt_login_in_isolated_read_only_run(inputs, monkeypatch, stage):
    calls, working_directories = [], []
    if stage == "count":
        inputs[0]["identification"] = {"matches": [{"sku_id": "sku-a", "status": "uncertain",
            "reason": "Pode ser outra gramatura.", "evidence_frame_ids": ["frame-main"]},
            {"sku_id": "other-sku", "status": "absent", "reason": "Não observado.", "evidence_frame_ids": []}]}
    monkeypatch.setenv("OPENAI_API_KEY", "test-secret")
    monkeypatch.setenv("CODEX_API_KEY", "another-secret")
    monkeypatch.setenv("CODEX_THREAD_ID", "parent-session")

    def run(argv, **kwargs):
        calls.append(argv)
        working_directories.append(kwargs["cwd"])
        assert kwargs["shell"] is False and kwargs["capture_output"] is True
        assert "OPENAI_API_KEY" not in kwargs["env"] and "CODEX_API_KEY" not in kwargs["env"]
        assert "CODEX_THREAD_ID" not in kwargs["env"]
        if argv[1:] == ["login", "status"]:
            return subprocess.CompletedProcess(argv, 0, "", "Logged in using ChatGPT\n")
        assert "--ignore-user-config" in argv and "--ephemeral" in argv
        assert argv[argv.index("--sandbox") + 1] == "read-only"
        assert 'forced_login_method="chatgpt"' in argv
        assert "features.shell_tool=false" in argv and "features.apps=false" in argv
        assert "features.plugins=false" in argv and "features.hooks=false" in argv
        assert "--dangerously-bypass-approvals-and-sandbox" not in argv
        assert argv[argv.index("--model") + 1] == "configured-model"
        images = [Path(argv[index + 1]) for index, item in enumerate(argv) if item == "--image"]
        assert len(images) == 3 and all(path.parent == Path(kwargs["cwd"]) for path in images)
        assert [path.read_bytes() for path in images] == [b"synthetic-image-payload", b"synthetic-detail-payload", b"synthetic-image-payload"]
        prompt = kwargs["input"]
        assert prompt.index("Imagem 1: Frame PRINCIPAL") < prompt.index("Imagem 2: Frame COMPLEMENTAR") < prompt.index("Imagem 3: REFERÊNCIA")
        assert "IDENTIFICAR" in prompt if stage == "identify" else "CONTAR" in prompt
        if stage == "count":
            assert '"status": "uncertain"' in prompt and "Pode ser outra gramatura." in prompt
            assert "other-sku" not in prompt
        schema = json.loads(Path(argv[argv.index("--output-schema") + 1]).read_text())
        assert schema["additionalProperties"] is False
        assert set(path.name for path in Path(kwargs["cwd"]).iterdir()) == {"schema.json", "image-001.jpg", "image-002.jpg", "image-003.jpg"}
        Path(argv[argv.index("--output-last-message") + 1]).write_text(json.dumps(prediction(stage)))
        return subprocess.CompletedProcess(argv, 0, '\n'.join([
            json.dumps({"type": "thread.started", "thread_id": "thread-test"}),
            json.dumps({"type": "turn.completed", "usage": {"input_tokens": 125, "cached_input_tokens": 20, "output_tokens": 50}}),
        ]), "")

    monkeypatch.setattr(subprocess, "run", run)
    result = getattr(CodexProvider("configured-model"), stage)(*inputs)
    assert len(calls) == 2
    assert result.prediction == prediction(stage) and result.simulated is False
    assert result.request_id == "thread-test" and result.usage["cached_input_tokens"] == 20
    assert all(not Path(directory).exists() for directory in working_directories)


@pytest.mark.parametrize("login_output", ["Not logged in", "Logged in using an API key test-secret"])
def test_codex_refuses_missing_or_api_login_without_fallback(inputs, monkeypatch, login_output):
    calls = []

    def run(argv, **kwargs):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 0, "", login_output)

    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises(ProviderError, match="assinatura ChatGPT") as error:
        CodexProvider("configured-model").count(*inputs)
    assert len(calls) == 1 and "test-secret" not in str(error.value)


@pytest.mark.parametrize("failure", ["timeout", "missing", "exit", "turn-failed", "invalid-json", "invalid-schema", "missing-completed"])
def test_codex_failure_is_actionable_and_does_not_leak_output(inputs, monkeypatch, failure):
    def run(argv, **kwargs):
        if argv[1:] == ["login", "status"]:
            return subprocess.CompletedProcess(argv, 0, "Logged in using ChatGPT", "")
        if failure == "timeout":
            raise subprocess.TimeoutExpired(argv, 180, output="test-secret")
        if failure == "missing":
            raise FileNotFoundError("test-secret")
        payload = prediction()
        if failure == "invalid-schema":
            payload["counts"][0]["sku_id"] = "unknown"
        Path(argv[argv.index("--output-last-message") + 1]).write_text("invalid" if failure == "invalid-json" else json.dumps(payload))
        events = [{"type": "turn.completed", "usage": {"input_tokens": 100, "output_tokens": 50}}]
        if failure == "turn-failed":
            events.append({"type": "turn.failed", "error": {"message": "test-secret"}})
        if failure == "missing-completed":
            events = []
        return subprocess.CompletedProcess(argv, 1 if failure == "exit" else 0, '\n'.join(map(json.dumps, events)), "test-secret")

    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises(ProviderError) as error:
        CodexProvider("configured-model").count(*inputs)
    assert "test-secret" not in str(error.value)
    if failure in {"exit", "turn-failed", "invalid-json", "invalid-schema"}:
        assert error.value.usage["input_tokens"] == 100


def test_mock_is_deterministic_and_labeled_in_both_stages(inputs):
    mock = MockProvider()
    for stage, field in [("identify", "matches"), ("count", "counts")]:
        first = getattr(mock, stage)(*inputs)
        assert first == getattr(mock, stage)(*inputs)
        assert first.simulated is True and first.usage == {}
        assert all("SIMULAÇÃO" in row["reason"] for row in first.prediction[field])
