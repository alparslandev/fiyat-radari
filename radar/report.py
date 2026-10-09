import json
import os
import urllib.error
import urllib.request

from .catalog import SITE_NAMES
from .model import STATUS_LABELS, STATUS_OK
from .money import format_tl

USER_AGENT = "fiyat-radari/1.0"
INGEST_TIMEOUT_SECONDS = 45
INGEST_ATTEMPTS = 2


class IngestError(Exception):
    pass


def build_payload(site_results, observed_at, dispatched_at, run_url, duration_ms):
    return {
        "version": 1,
        "observed_at": observed_at,
        "dispatched_at": dispatched_at or None,
        "run_url": run_url,
        "duration_ms": duration_ms,
        "sites": {result.site: result.to_json() for result in site_results},
    }


def post_ingest(url, token, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": f"Bearer {token}",
        "User-Agent": USER_AGENT,
    }
    last_error = None
    for _ in range(INGEST_ATTEMPTS):
        request = urllib.request.Request(url, data=body, method="POST", headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=INGEST_TIMEOUT_SECONDS) as response:
                return json.loads(response.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as error:
            last_error = f"HTTP {error.code}"
            if error.code < 500:
                break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = str(error)
    raise IngestError(last_error or "bilinmeyen hata")


def _decision_line(decision):
    if not decision:
        return None
    if decision.get("ignored"):
        return f"Worker bu sonucu yok saydı ({decision['ignored']})."
    best = decision.get("best")
    if decision.get("deal") and best:
        return f"FIRSAT bildirildi: {format_tl(best.get('effective'))}, {SITE_NAMES.get(best.get('site'), best.get('site'))}, {best.get('color')}."
    normal = decision.get("normal")
    return f"Fırsat yok. Olağan fiyat: {format_tl(normal)}." if normal else "Fırsat yok. Olağan fiyat için veri birikiyor."


def summary_markdown(site_results, decision, note, duration_ms):
    lines = [
        "## Fiyat Radarı taraması",
        "",
        "| Site | Durum | En ucuz uygun teklif | Renk | Satıcı |",
        "|---|---|---|---|---|",
    ]
    for result in site_results:
        best = result.best_qualifying()
        status = STATUS_LABELS.get(result.status, result.status)
        if result.detail:
            status = f"{status} ({result.detail})"
        lines.append(
            f"| {SITE_NAMES.get(result.site, result.site)} | {status} | "
            f"{format_tl(best.effective) if best else '-'} | {best.color if best else '-'} | {best.seller if best else '-'} |"
        )
    lines += ["", f"Süre: {round(duration_ms / 1000)} sn. {note}."]
    decision_line = _decision_line(decision)
    if decision_line:
        lines.append(decision_line)
    return "\n".join(lines) + "\n"


def write_step_summary(markdown):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(markdown)
