import json
import time
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from .catalog import COUNTRY_CHOICE_COOKIES, RELOAD_ONCE_WHEN_BLOCKED, SITES, WARMUP_URLS, products_for
from .model import STATUS_BLOCKED, STATUS_ERROR, STATUS_OK, PageResult, SiteResult
from .sites import ADAPTERS

LOCALE = "tr-TR"
TIMEZONE = "Europe/Istanbul"
VIEWPORT = {"width": 1600, "height": 900}
NAVIGATION_TIMEOUT_MS = 30_000
READY_TIMEOUT_MS = 25_000
WARMUP_PAUSE_MS = 1_500
RELOAD_PAUSE_MS = 2_500
MIN_STEP_TIMEOUT_MS = 1_000
BLOCKING_STATUSES = {403, 429, 503}


@contextmanager
def chrome(headless):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=headless)
        try:
            yield browser
        finally:
            browser.close()


def _remaining_ms(deadline):
    return int((deadline - time.monotonic()) * 1000)


def _step_timeout(limit_ms, deadline):
    return min(limit_ms, max(_remaining_ms(deadline), MIN_STEP_TIMEOUT_MS))


def _save_diagnostics(page, directory, name, raw):
    directory.mkdir(parents=True, exist_ok=True)
    try:
        page.screenshot(path=str(directory / f"{name}.png"))
    except PlaywrightError:
        pass
    (directory / f"{name}.json").write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8")


def _visit(page, adapter, product, deadline):
    started = time.monotonic()
    raw = {}
    try:
        response = page.goto(product.url, wait_until="commit", timeout=_step_timeout(NAVIGATION_TIMEOUT_MS, deadline))
        status_code = response.status if response else None
        try:
            page.wait_for_function(adapter.READY_JS, timeout=_step_timeout(READY_TIMEOUT_MS, deadline))
        except PlaywrightTimeoutError:
            pass
        raw = page.evaluate(adapter.EXTRACT_JS)
        raw["http_status"] = status_code
        raw["final_url"] = page.url
        result = adapter.parse(raw, product)
        if result.status != STATUS_OK and status_code in BLOCKING_STATUSES and not raw.get("challenge"):
            result = PageResult(product.product_id, product.color, STATUS_BLOCKED, f"HTTP {status_code}")
    except PlaywrightTimeoutError:
        result = PageResult(product.product_id, product.color, STATUS_ERROR, "zaman aşımı")
    except PlaywrightError as error:
        message = str(error).splitlines()[0][:160]
        status = STATUS_BLOCKED if "ERR_HTTP_RESPONSE_CODE_FAILURE" in message else STATUS_ERROR
        result = PageResult(product.product_id, product.color, status, message)
    result.duration_ms = int((time.monotonic() - started) * 1000)
    return result, raw


def _warm_up(page, site):
    url = WARMUP_URLS.get(site)
    if not url:
        return
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
        page.wait_for_timeout(WARMUP_PAUSE_MS)
    except PlaywrightError:
        pass


def scan(browser, deadline, diagnostics_dir=None, always_diagnose=False, raw_sink=None):
    results = []
    for site in SITES:
        adapter = ADAPTERS[site]
        site_result = SiteResult(site)
        context = browser.new_context(locale=LOCALE, timezone_id=TIMEZONE, viewport=VIEWPORT)
        context.add_cookies(list(COUNTRY_CHOICE_COOKIES.get(site, ())))
        try:
            page = context.new_page()
            _warm_up(page, site)
            for product in products_for(site):
                if _remaining_ms(deadline) <= 0:
                    site_result.pages.append(PageResult(product.product_id, product.color, STATUS_ERROR, "süre doldu"))
                    continue
                result, raw = _visit(page, adapter, product, deadline)
                if result.status == STATUS_BLOCKED and site in RELOAD_ONCE_WHEN_BLOCKED and _remaining_ms(deadline) > NAVIGATION_TIMEOUT_MS:
                    page.wait_for_timeout(RELOAD_PAUSE_MS)
                    first_ms = result.duration_ms
                    result, raw = _visit(page, adapter, product, deadline)
                    result.duration_ms += first_ms + RELOAD_PAUSE_MS
                site_result.pages.append(result)
                if raw_sink is not None:
                    raw_sink(product, raw, result)
                if diagnostics_dir and (always_diagnose or result.status != STATUS_OK):
                    _save_diagnostics(page, Path(diagnostics_dir), f"{site}-{product.product_id}", raw)
        finally:
            context.close()
        results.append(site_result)
    return results
