import json
import math
import os
import time
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from .browser import chrome, scan
from .catalog import SITE_NAMES, SITES
from .model import STATUS_OK
from .money import format_tl
from .report import USER_AGENT, write_step_summary

TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace"
SPIKE_DEADLINE_SECONDS = 240
PASS_RATIO_GATE = 16 / 18
P90_GATE_MS = 90_000


def _egress():
    try:
        request = urllib.request.Request(TRACE_URL, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=10) as response:
            pairs = dict(line.split("=", 1) for line in response.read().decode().splitlines() if "=" in line)
        return {"ip": pairs.get("ip"), "colo": pairs.get("colo"), "loc": pairs.get("loc")}
    except OSError:
        return {}


def _page_best(page):
    prices = [offer.effective for offer in page.offers if offer.qualifies] or [offer.effective for offer in page.offers]
    return min(prices) if prices else None


def run_spike(variant, headless, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with chrome(headless) as browser:
        chrome_version = browser.version
        results = scan(browser, started + SPIKE_DEADLINE_SECONDS, diagnostics_dir=out, always_diagnose=True)
    record = {
        "variant": variant,
        "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "runner_os": os.environ.get("RUNNER_OS"),
        "image": os.environ.get("ImageVersion"),
        "chrome": chrome_version,
        "egress": _egress(),
        "duration_ms": int((time.monotonic() - started) * 1000),
        "pages": [
            {
                "site": result.site,
                "product_id": page.product_id,
                "color": page.color,
                "status": page.status,
                "detail": page.detail,
                "ms": page.duration_ms,
                "best": _page_best(page),
            }
            for result in results
            for page in result.pages
        ],
    }
    (out / "result.json").write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8")
    lines = [f"## Erişim testi: {variant}", "", f"Çıkış IP: {record['egress'].get('ip')} ({record['egress'].get('colo')}), Chrome {chrome_version}", "", "| Site | Renk | Durum | Süre | Fiyat |", "|---|---|---|---|---|"]
    for page in record["pages"]:
        lines.append(f"| {SITE_NAMES[page['site']]} | {page['color']} | {page['status']} {page['detail']} | {page['ms'] / 1000:.1f} sn | {format_tl(page['best'])} |")
    markdown = "\n".join(lines) + "\n"
    write_step_summary(markdown)
    print(markdown)
    return 0


def _p90(values):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(0.9 * len(ordered)) - 1)]


def summarize_spike(input_dir):
    records = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(Path(input_dir).rglob("result.json"))]
    jobs = defaultdict(lambda: {"jobs": 0, "passed": 0, "times": [], "problems": Counter()})
    for record in records:
        for site in SITES:
            pages = [page for page in record["pages"] if page["site"] == site]
            bucket = jobs[(record["variant"], site)]
            bucket["jobs"] += 1
            if pages and all(page["status"] == STATUS_OK for page in pages):
                bucket["passed"] += 1
            bucket["times"] += [page["ms"] for page in pages if page["status"] == STATUS_OK]
            bucket["problems"].update(f"{page['status']} {page['detail']}".strip() for page in pages if page["status"] != STATUS_OK)
    lines = ["## Erişim testi özeti", "", f"{len(records)} makine sonucu okundu.", "", "| Yapılandırma | Site | Geçen makine | Sayfa p90 | Sorunlar |", "|---|---|---|---|---|"]
    for (variant, site), bucket in sorted(jobs.items()):
        p90 = _p90(bucket["times"])
        problems = ", ".join(f"{name} ×{count}" for name, count in bucket["problems"].most_common(3)) or "-"
        lines.append(f"| {variant} | {SITE_NAMES[site]} | {bucket['passed']}/{bucket['jobs']} | {f'{p90 / 1000:.1f} sn' if p90 else '-'} | {problems} |")
    lines += ["", "Geçme şartı (3 çalıştırmanın toplamında): her site için en az bir yapılandırmada makinelerin en az %89'u (16/18) geçmeli, sayfaların %90'ı 90 sn altında açılmalı."]
    markdown = "\n".join(lines) + "\n"
    write_step_summary(markdown)
    print(markdown)
    return 0
