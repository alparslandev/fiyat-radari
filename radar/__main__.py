import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from .browser import chrome, scan
from .model import STATUS_OK
from .report import IngestError, build_payload, post_ingest, summary_markdown, write_step_summary
from .spike import run_spike, summarize_spike

RUN_DEADLINE_SECONDS = 150
CAPTURE_DEADLINE_SECONDS = 300


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _run_url():
    server = os.environ.get("GITHUB_SERVER_URL")
    repository = os.environ.get("GITHUB_REPOSITORY")
    run_id = os.environ.get("GITHUB_RUN_ID")
    return f"{server}/{repository}/actions/runs/{run_id}" if server and repository and run_id else None


def command_run(args):
    started = time.monotonic()
    with chrome(args.headless) as browser:
        results = scan(browser, started + RUN_DEADLINE_SECONDS, diagnostics_dir=args.tani)
    duration_ms = int((time.monotonic() - started) * 1000)
    payload = build_payload(results, _now_iso(), os.environ.get("RADAR_DISPATCHED_AT"), _run_url(), duration_ms)
    url = os.environ.get("RADAR_INGEST_URL")
    token = os.environ.get("RADAR_INGEST_TOKEN")
    decision = None
    exit_code = 0
    if args.dry_run or not url or not token:
        note = "Kuru çalışma, Worker'a gönderilmedi"
    else:
        try:
            decision = post_ingest(url, token, payload)
            note = "Sonuç Worker'a gönderildi"
        except IngestError as error:
            note = f"Sonuç Worker'a gönderilemedi: {error}"
            exit_code = 1
    markdown = summary_markdown(results, decision, note, duration_ms)
    write_step_summary(markdown)
    print(markdown)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
    return exit_code


def command_capture(args):
    out = Path(args.out)

    def save(product, raw, result):
        if not raw:
            return
        directory = out / product.site
        directory.mkdir(parents=True, exist_ok=True)
        suffix = "" if result.status == STATUS_OK else f".{result.status}"
        (directory / f"{product.product_id}{suffix}.json").write_text(json.dumps(raw, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    started = time.monotonic()
    with chrome(args.headless) as browser:
        results = scan(browser, started + CAPTURE_DEADLINE_SECONDS, raw_sink=save)
    print(summary_markdown(results, None, "Fixture yakalama", int((time.monotonic() - started) * 1000)))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="radar")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    run.add_argument("--headless", action="store_true")
    run.add_argument("--dry-run", action="store_true")
    run.add_argument("--json", action="store_true")
    run.add_argument("--tani", default="tani")
    capture = commands.add_parser("capture")
    capture.add_argument("--headless", action="store_true")
    capture.add_argument("--out", default="tests/fixtures")
    spike = commands.add_parser("spike")
    spike.add_argument("--variant", required=True)
    spike.add_argument("--headless", action="store_true")
    spike.add_argument("--out", default="spike-out")
    spike_summary = commands.add_parser("spike-ozet")
    spike_summary.add_argument("input_dir")
    args = parser.parse_args(argv)
    if args.command == "run":
        return command_run(args)
    if args.command == "capture":
        return command_capture(args)
    if args.command == "spike":
        return run_spike(args.variant, args.headless, args.out)
    return summarize_spike(args.input_dir)


if __name__ == "__main__":
    sys.exit(main())
