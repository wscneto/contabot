"""Exercise real browser forms on an isolated local mock server.

Run from the repository root after installing the browser optional dependency:
    uv run --extra browser python -m scripts.browser_smoke --chromium /usr/bin/chromium

Omit --chromium to use Playwright's installed Chromium. Add --screenshots to save
desktop/mobile captures. The default output is demo/browser/summary.json. This
software regression check uses synthetic images, quantities and review actions;
it does not measure operational accuracy. No existing pilot database is used.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import socket
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

import httpx

from contabot.config import Settings
from scripts.generate_demo import generate


@contextmanager
def _server(root: Path):
    settings = Settings(data_dir=root / "data", provider="mock")
    environment = os.environ.copy()
    # Set every application option explicitly: neither shell settings nor .env
    # can choose a real provider, credentials, endpoint, or an existing database.
    for name in settings.__dataclass_fields__:
        key = "OPENAI_API_KEY" if name == "api_key" else "CONTABOT_" + name.upper()
        value = getattr(settings, name)
        environment[key] = json.dumps(value) if isinstance(value, dict) else str(value)
    environment["PYTHON_DOTENV_DISABLED"] = "1"
    log_path = root / "server.log"
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener, log_path.open("w+") as log:
        # Keep the bound descriptor open until shutdown, avoiding the free-port
        # race between choosing a port and launching the subprocess.
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        port = listener.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "contabot.app:create_app", "--factory",
             "--fd", str(listener.fileno()), "--workers", "1", "--log-level", "warning"],
            env=environment, pass_fds=(listener.fileno(),), stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 15
            with httpx.Client(timeout=0.4, trust_env=False) as client:
                while time.monotonic() < deadline and process.poll() is None:
                    try:
                        response = client.get(base + "/api/config")
                        if response.is_success and response.json().get("simulated") is True:
                            break
                    except (httpx.HTTPError, ValueError):
                        pass
                    time.sleep(0.05)
                else:
                    log.flush()
                    raise RuntimeError("Servidor temporário não ficou pronto em 15 segundos.\n" + log_path.read_text()[-3000:])
            yield base
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def run(output: Path, chromium: Path | None = None, screenshots: bool = False) -> dict:
    try:
        from playwright.sync_api import expect, sync_playwright
    except ImportError as error:
        raise RuntimeError("Instale a dependência de navegador: uv sync --extra browser.") from error
    if chromium is not None and not chromium.is_file():
        raise ValueError(f"Executável Chromium não encontrado: {chromium}")
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="contabot-browser-") as temporary:
        root = Path(temporary)
        capture = root / "capture"
        manifest = generate(capture)
        with _server(root) as base, sync_playwright() as playwright:
            options = {"headless": True, "args": ["--disable-background-networking", "--no-sandbox"]}
            if chromium is not None:
                options["executable_path"] = str(chromium.resolve())
            browser = playwright.chromium.launch(**options)
            try:
                context = browser.new_context(viewport={"width": 1440, "height": 1100}, service_workers="block")
                external_requests: list[str] = []
                errors: list[str] = []

                def local_only(route):
                    request_url = urlsplit(route.request.url)
                    if request_url.scheme == "http" and request_url.netloc == urlsplit(base).netloc:
                        route.continue_()
                    else:
                        external_requests.append(request_url.netloc or request_url.scheme)
                        route.abort()

                context.route("**/*", local_only)
                page = context.new_page()
                page.set_default_timeout(15_000)
                page.on("pageerror", lambda error: errors.append(str(error)))

                def operation(action, method: str, path: str):
                    with page.expect_response(lambda response: response.url == base + path and response.request.method == method, timeout=30_000) as pending:
                        action()
                    response = pending.value
                    if not response.ok:
                        raise RuntimeError(f"Formulário falhou: {method} {path}: HTTP {response.status}: {response.text()}")
                    return None if response.status == 204 else response.json()

                page.goto(base + "/#catalog")
                expect(page.locator("#sku-form")).to_be_visible()
                sku_ids = {}
                for sku in manifest["skus"]:
                    form = page.locator("#sku-form")
                    form.locator('[name="name"]').fill(sku["name"])
                    form.locator('[name="photos"]').set_input_files(str(capture / sku["reference_photo"]))
                    saved = operation(lambda: form.locator('button[type="submit"]').click(), "POST", "/api/skus")
                    sku_ids[sku["id"]] = saved["id"]
                    expect(form.locator('[name="name"]')).to_have_value("")

                page.locator('a[href="#count"]').first.click()
                form = page.locator("#video-form")
                expect(form).to_be_visible()
                form.locator('[name="video"]').set_input_files(str(capture / manifest["video"]))
                created = operation(lambda: form.locator('button[type="submit"]').click(), "POST", "/api/videos")
                video_path = f"/api/videos/{created['id']}"
                form = page.locator("#counts-form")
                expect(form).to_be_visible(timeout=30_000)
                original_video = page.request.get(base + video_path).json()
                edited_sku = sku_ids[manifest["skus"][0]["id"]]
                old_reference = next(sku for sku in original_video["catalog"] if sku["id"] == edited_sku)
                page.locator('a[href="#catalog"]').first.click()
                page.locator(f'[data-edit-sku="{edited_sku}"]').click()
                edit_form = page.locator("#sku-form")
                edit_form.locator('[name="name"]').fill("Alteração descartada")
                edit_form.get_by_role("link", name="Cancelar").click()
                expect(page.locator('#sku-form [name="name"]')).to_have_value("")
                page.locator(f'[data-edit-sku="{edited_sku}"]').click()
                edited_name = "Caixa fictícia A — referência conferida"
                edit_form.locator('[name="name"]').fill(edited_name)
                updated_sku = operation(lambda: edit_form.locator('button[type="submit"]').click(), "PATCH", f"/api/skus/{edited_sku}")
                if updated_sku["photos"] != old_reference["photos"]:
                    raise RuntimeError("Editar somente o nome removeu as fotos de referência.")
                old_snapshot = page.request.get(base + video_path).json()
                if next(sku for sku in old_snapshot["catalog"] if sku["id"] == edited_sku) != old_reference:
                    raise RuntimeError("Editar o catálogo alterou a referência da análise anterior.")
                expect(page.locator('#sku-form [name="name"]')).to_have_value("")
                page.locator('a[href="#count"]').first.click()
                page.locator(f'.video-card[href="#video/{created["id"]}"]').click()
                expect(page.locator("#counts-form")).to_be_visible()
                operation(lambda: page.locator("#retry-button").click(), "POST", video_path + "/retry")
                expect(page.get_by_role("heading", name=edited_name, exact=True)).to_be_visible(timeout=30_000)
                form = page.locator("#counts-form")
                inferred = page.request.get(base + video_path).json()
                if next(sku for sku in inferred["catalog"] if sku["id"] == edited_sku)["name"] != edited_name:
                    raise RuntimeError("A nova análise não usou o catálogo atualizado.")
                original_prediction = inferred["prediction"]
                if not original_prediction or not inferred["simulated"]:
                    raise RuntimeError("O navegador não recebeu uma sugestão explicitamente simulada.")
                corrected_counts = {sku_ids[sku]: quantity for sku, quantity in manifest["rendered_quantities"].items()}
                for sku, quantity in corrected_counts.items():
                    form.locator(f'[data-sku="{sku}"]').fill(str(quantity))
                corrected = operation(lambda: form.locator('button[type="submit"]').click(), "PATCH", video_path + "/counts")
                if corrected["confirmed_counts"] != corrected_counts or corrected["prediction"] != original_prediction:
                    raise RuntimeError("A correção alterou a sugestão original ou não salvou as quantidades.")
                exported = page.request.get(base + video_path + "/export").json()
                if exported["video"]["prediction"] != original_prediction:
                    raise RuntimeError("A exportação não preservou a sugestão original.")
                # This test intentionally submits no reviewer, shelf, notes or timers.
                for field in ("reviewer", "boundary_note", "dataset_group", "review_seconds"):
                    expect(page.locator(f'[name="{field}"]')).to_have_count(0)
                expect(page.locator(".result-row")).to_have_count(2)
                if screenshots:
                    page.screenshot(path=str(output / "desktop.png"), full_page=True)
                page.set_viewport_size({"width": 390, "height": 844})
                if page.evaluate("document.documentElement.scrollWidth > window.innerWidth"):
                    raise RuntimeError("A interface tem rolagem horizontal a 390 pixels.")
                if screenshots:
                    page.screenshot(path=str(output / "mobile.png"), full_page=True)
                page.locator('a[href="#catalog"]').first.click()
                expect(page.locator(".product")).to_have_count(2)
                delete_requests = []
                page.on("request", lambda request: delete_requests.append(request.url) if request.method == "DELETE" else None)
                def reject_deletion(dialog):
                    if edited_name not in dialog.message:
                        raise RuntimeError("A confirmação de exclusão não identifica o produto.")
                    dialog.dismiss()
                page.once("dialog", reject_deletion)
                page.locator(f'[data-delete-sku="{edited_sku}"]').click()
                expect(page.locator(".product")).to_have_count(2)
                if delete_requests or len(page.request.get(base + "/api/skus").json()) != 2:
                    raise RuntimeError("Cancelar a confirmação excluiu um produto.")
                # Deleting the product being edited must reset the same form.
                page.locator(f'[data-edit-sku="{edited_sku}"]').click()
                expect(page.locator('#sku-form [name="name"]')).to_have_value(edited_name)
                page.once("dialog", lambda dialog: dialog.accept())
                operation(lambda: page.locator(f'[data-delete-sku="{edited_sku}"]').click(), "DELETE", f"/api/skus/{edited_sku}")
                expect(page.locator(".product")).to_have_count(1)
                expect(page.locator('#sku-form [name="name"]')).to_have_value("")
                expect(page.locator("#sku-form")).to_have_attribute("data-edit-id", "")
                if page.evaluate("document.documentElement.scrollWidth > window.innerWidth"):
                    raise RuntimeError("O catálogo com exclusão tem rolagem horizontal a 390 pixels.")
                remaining = next(identifier for identifier in sku_ids.values() if identifier != edited_sku)
                page.once("dialog", lambda dialog: dialog.accept())
                operation(lambda: page.locator(f'[data-delete-sku="{remaining}"]').click(), "DELETE", f"/api/skus/{remaining}")
                expect(page.locator(".product")).to_have_count(0)
                page.locator('a[href="#count"]').first.click()
                expect(page.locator("#video-form")).to_have_count(0)
                expect(page.get_by_role("link", name="Cadastrar produtos")).to_be_visible()
                if page.request.get(base + "/api/skus").json():
                    raise RuntimeError("Excluir o último produto não esvaziou o catálogo.")
                saved_video = page.request.get(base + video_path).json()
                if saved_video["prediction"] != original_prediction or saved_video["confirmed_counts"] != corrected_counts:
                    raise RuntimeError("Excluir produtos alterou uma contagem anterior.")
                for photo in (old_reference["photos"][0], saved_video["results"][0]["photo"]):
                    if not page.request.get(base + photo).ok:
                        raise RuntimeError("Excluir o produto removeu uma foto usada no histórico.")
                # A deliberately simulated response exercises the partial-count
                # display independently of a model's behavior. No real API runs.
                partial_video = copy.deepcopy(saved_video)
                partial_video.update(status="needs_review", confirmed_counts=None)
                evidence_frame = partial_video["frames"][-1]
                for index, result in enumerate(partial_video["results"]):
                    result.update(quantity=2 if index == 0 else None, confirmed_quantity=None,
                        incomplete=True, needs_review=True, evidence_frame_ids=[evidence_frame["id"]] if index == 0 else [],
                        reason="Cenário sintético: apenas parte dos produtos aparece com nitidez.")
                partial_video["prediction"] = {"video_id": created["id"], "coverage_complete": False,
                    "overlap_resolved": False, "unknown_products": [], "counts": [
                        {key:result[key] for key in ("sku_id", "quantity", "incomplete", "needs_review", "reason", "evidence_frame_ids")}
                        for result in partial_video["results"]]}
                def partial_detail(route):
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(partial_video))
                def partial_correction(route):
                    counts = route.request.post_data_json["counts"]
                    partial_video["confirmed_counts"] = counts
                    for result in partial_video["results"]:
                        result["confirmed_quantity"] = counts[result["sku_id"]]
                    partial_detail(route)
                page.route(base + video_path, partial_detail)
                page.route(base + video_path + "/counts", partial_correction)
                page.goto(base + f'/#video/{created["id"]}')
                partial_row = page.locator(".result-row").first
                unknown_row = page.locator(".result-row").nth(1)
                expect(partial_row.locator(".result-quantity")).to_have_text("2 unidades visíveis")
                expect(partial_row.locator(".count-scope")).to_contain_text("Contagem parcial")
                expect(partial_row.get_by_role("link", name="Neste frame")).to_have_attribute("href", evidence_frame["url"])
                expect(unknown_row.locator(".result-quantity")).to_have_text("Não foi possível contar")
                page.locator("details.evidence summary").click()
                expect(page.locator(".frames a")).to_have_count(1)
                expect(page.locator(".frames a")).to_have_attribute("href", evidence_frame["url"])
                partial_row.locator("[data-sku]").fill("4")
                operation(lambda: page.locator('#counts-form button[type="submit"]').click(), "PATCH", video_path + "/counts")
                expect(partial_row.locator(".result-quantity")).to_have_text("4 unidades visíveis")
                expect(partial_row.locator(".original")).to_contain_text("sugestão: 2")
                expect(partial_row.locator(".count-scope")).to_contain_text("Contagem parcial")
                expect(partial_row.get_by_role("link", name="Neste frame")).to_have_attribute("href", evidence_frame["url"])
                expect(page.locator("#counts-form .notice")).to_contain_text("Contagem parcial")
                expect(unknown_row.locator(".result-quantity")).to_have_text("Não foi possível contar")
                if partial_video["prediction"]["counts"][0]["quantity"] != 2:
                    raise RuntimeError("Corrigir a contagem parcial alterou sua sugestão original.")
                if page.evaluate("document.documentElement.scrollWidth > window.innerWidth"):
                    raise RuntimeError("A contagem parcial tem rolagem horizontal a 390 pixels.")
                if screenshots:
                    page.screenshot(path=str(output / "partial-mobile.png"), full_page=True)
                page.unroute(base + video_path, partial_detail)
                page.unroute(base + video_path + "/counts", partial_correction)
                if errors or external_requests:
                    raise RuntimeError(f"Erros JavaScript: {errors}; requisições externas: {external_requests}")
                summary = {"status": "passed", "browser": "Chromium", "simulated": True,
                    "flow": "catalog → video → automatic identification/count → edit/retry → correction → delete/cancel",
                    "confirmed_counts": corrected_counts, "original_prediction_preserved": True,
                    "deletion_cancelled_without_request": True, "empty_catalog_after_last_deletion": True,
                    "historical_results_and_photos_preserved": True,
                    "partial_count_label_and_frame_evidence": True, "partial_scope_preserved_after_correction": True,
                    "mobile_width": 390, "horizontal_overflow": False, "javascript_errors": errors,
                    "external_requests": external_requests, "screenshots": screenshots,
                    "notice": "Teste de software com dados sintéticos; não comprova precisão operacional."}
            finally:
                browser.close()
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chromium", type=Path, help="Executável local; omitido usa Chromium instalado pelo Playwright")
    parser.add_argument("--output", type=Path, default=Path("demo/browser"))
    parser.add_argument("--screenshots", action="store_true", help="Salvar desktop.png e mobile.png além do resumo")
    args = parser.parse_args()
    try:
        result = run(args.output, args.chromium, args.screenshots)
    except (RuntimeError, ValueError) as error:
        parser.exit(1, f"Demonstração de navegador falhou: {error}\n")
    print(json.dumps(result, ensure_ascii=False))
