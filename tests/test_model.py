from radar.model import STATUS_BLOCKED, STATUS_NO_DATA, STATUS_OK, STATUS_PRODUCT_CHANGED, PageResult, SiteResult


def _site(*statuses):
    return SiteResult("amazon", [PageResult(f"P{index}", f"Renk {index}", status, "" if status == STATUS_OK else status) for index, status in enumerate(statuses)])


def test_a_site_counts_as_working_when_any_page_opens():
    site = _site(STATUS_BLOCKED, STATUS_OK, STATUS_BLOCKED)
    assert site.status == STATUS_OK
    assert site.pages_failed == ["P0", "P2"]
    assert site.to_json()["pages_ok"] == 1


def test_a_site_with_every_page_blocked_reports_the_block():
    assert _site(STATUS_BLOCKED, STATUS_BLOCKED, STATUS_BLOCKED).status == STATUS_BLOCKED


def test_a_changed_product_always_surfaces():
    assert _site(STATUS_OK, STATUS_PRODUCT_CHANGED, STATUS_OK).status == STATUS_PRODUCT_CHANGED


def test_a_site_without_pages_has_no_data():
    assert SiteResult("trendyol").status == STATUS_NO_DATA
