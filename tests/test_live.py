import os
import time

import pytest

from radar.browser import chrome, scan
from radar.model import STATUS_OK

pytestmark = pytest.mark.skipif(os.environ.get("LIVE_TESTS") != "1", reason="canlı test için LIVE_TESTS=1")


def test_every_tracked_page_loads_and_parses():
    with chrome(headless=os.environ.get("LIVE_HEADLESS") == "1") as browser:
        results = scan(browser, time.monotonic() + 300)
    problems = [(result.site, page.color, page.status, page.detail) for result in results for page in result.pages if page.status != STATUS_OK]
    assert problems == []
