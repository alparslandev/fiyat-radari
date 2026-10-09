import io
import json
import urllib.error

import pytest

from radar import report
from radar.model import STATUS_BLOCKED, STATUS_OK, Offer, PageResult, SiteResult


def _offer(effective, qualifies=True):
    return Offer("trendyol:1:968", "trendyol", "Gümüş", "Trendyol", 9.3, effective, effective, "liste", "https://example.test", True, qualifies, None if qualifies else "dusuk_puan", ("not",))


def _results():
    trendyol = SiteResult("trendyol", [PageResult("1", "Gümüş", STATUS_OK, "", [_offer(105000), _offer(90000, qualifies=False)])])
    amazon = SiteResult("amazon", [PageResult("A", "Abis", STATUS_OK), PageResult("B", "Gümüş", STATUS_BLOCKED, "amazon_ara_sayfa")])
    return [trendyol, amazon]


def test_payload_reports_site_status_and_offers():
    payload = report.build_payload(_results(), "2026-10-09T01:00:00Z", "", None, 41000)
    assert payload["dispatched_at"] is None
    assert payload["sites"]["trendyol"]["status"] == STATUS_OK
    assert payload["sites"]["trendyol"]["offers"][0]["notes"] == ["not"]
    assert payload["sites"]["amazon"] == {
        "status": STATUS_OK,
        "detail": "Gümüş: amazon_ara_sayfa",
        "pages_ok": 1,
        "pages_total": 2,
        "pages_failed": ["B"],
        "offers": [],
    }


def test_summary_shows_the_cheapest_qualifying_offer_in_turkish():
    markdown = report.summary_markdown(_results(), {"deal": False, "normal": 104000}, "Kuru çalışma", 41000)
    assert "| Trendyol | çalışıyor | 105.000 TL | Gümüş | Trendyol |" in markdown
    assert "| Amazon | çalışıyor (Gümüş: amazon_ara_sayfa) | - | - | - |" in markdown
    assert "Olağan fiyat: 104.000 TL" in markdown


class _Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_post_ingest_returns_the_worker_decision(monkeypatch):
    calls = []

    def fake_urlopen(request, timeout):
        calls.append((request.full_url, request.get_header("Authorization"), json.loads(request.data)))
        return _Response(json.dumps({"deal": False}).encode())

    monkeypatch.setattr(report.urllib.request, "urlopen", fake_urlopen)
    assert report.post_ingest("https://radar.example/ingest", "gizli", {"version": 1}) == {"deal": False}
    assert calls == [("https://radar.example/ingest", "Bearer gizli", {"version": 1})]


@pytest.mark.parametrize(("code", "attempts"), [(401, 1), (503, 2)])
def test_post_ingest_retries_only_server_errors(monkeypatch, code, attempts):
    calls = []

    def fake_urlopen(request, timeout):
        calls.append(1)
        raise urllib.error.HTTPError(request.full_url, code, "hata", {}, None)

    monkeypatch.setattr(report.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(report.IngestError, match=f"HTTP {code}"):
        report.post_ingest("https://radar.example/ingest", "gizli", {})
    assert len(calls) == attempts
