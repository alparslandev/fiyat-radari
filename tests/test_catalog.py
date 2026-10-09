from collections import Counter

import pytest

from radar.catalog import CATALOG, SITES
from radar.sites import ADAPTERS


def test_every_site_tracks_the_same_three_colors():
    colors = {site: sorted(product.color for product in CATALOG if product.site == site) for site in SITES}
    assert all(color_list == ["Abis", "Gümüş", "Kozmik Turuncu"] for color_list in colors.values())


def test_each_color_has_one_gtin_across_sites():
    gtins = {}
    for product in CATALOG:
        gtins.setdefault(product.color, set()).add(product.gtin)
    assert all(len(values) == 1 for values in gtins.values())


def test_product_ids_appear_in_their_urls_and_are_unique():
    assert all(product.product_id in product.url for product in CATALOG)
    assert max(Counter((product.site, product.product_id) for product in CATALOG).values()) == 1


@pytest.mark.parametrize("site", SITES)
def test_browser_scripts_have_their_helpers_inlined(site):
    adapter = ADAPTERS[site]
    for script in (adapter.READY_JS, adapter.EXTRACT_JS):
        assert "__CHALLENGE__" not in script
        assert "__JSONLD__" not in script
