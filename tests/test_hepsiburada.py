from radar.catalog import find_product
from radar.model import STATUS_BLOCKED, STATUS_OK, STATUS_PRODUCT_CHANGED
from radar.sites import hepsiburada

KOZMIK = find_product("hepsiburada", "HBCV00009Z3XL5")
GUMUS = find_product("hepsiburada", "HBCV00009Z40DM")


def _offers_by_seller(page):
    return {offer.seller: offer for offer in page.offers}


def test_hepsiburada_buybox_comes_from_the_current_listing(load_fixture):
    page = hepsiburada.parse(load_fixture("hepsiburada", "HBCV00009Z3XL5"), KOZMIK)
    assert page.status == STATUS_OK
    buybox = page.offers[0]
    assert (buybox.seller, buybox.effective, buybox.seller_score, buybox.qualifies) == ("Hepsiburada", 104899.0, None, True)
    assert buybox.url == KOZMIK.url


def test_hepsiburada_uses_the_discounted_price_shown_on_the_page(load_fixture):
    page = hepsiburada.parse(load_fixture("hepsiburada", "HBCV00009Z3XL5"), KOZMIK)
    troy = _offers_by_seller(page)["Troy Apple"]
    assert (troy.price, troy.effective, troy.basis) == (106075.08, 106075.08, "liste")


def test_hepsiburada_minimum_price_not_counted(load_fixture):
    raw = load_fixture("hepsiburada", "HBCV00009Z40DM")
    cetin = next(listing for listing in raw["listings"] if listing["merchantName"] == "Çetin Grup")
    assert cetin["minimumPrice"] < cetin["prices"][0]["value"]
    assert _offers_by_seller(hepsiburada.parse(raw, GUMUS))["Çetin Grup"].effective == cetin["prices"][0]["value"]


def test_hepsiburada_seller_links_select_the_store(load_fixture):
    page = hepsiburada.parse(load_fixture("hepsiburada", "HBCV00009Z3XL5"), KOZMIK)
    assert _offers_by_seller(page)["Troy Apple"].url == f"{KOZMIK.url}?magaza=Troy%20Apple"


def test_hepsiburada_missing_warranty_disqualifies(load_fixture):
    raw = load_fixture("hepsiburada", "HBCV00009Z3XL5")
    raw["warranty"] = "İthalatçı Garantili"
    assert {offer.why_not for offer in hepsiburada.parse(raw, KOZMIK).offers} == {"garanti"}


def test_hepsiburada_out_of_stock_buybox_is_info_only(load_fixture):
    raw = load_fixture("hepsiburada", "HBCV00009Z3XL5")
    raw["jsonld"]["availability"] = "https://schema.org/OutOfStock"
    assert hepsiburada.parse(raw, KOZMIK).offers[0].why_not == "stok_yok"


def test_hepsiburada_disagreeing_page_data_never_alerts(load_fixture):
    raw = load_fixture("hepsiburada", "HBCV00009Z3XL5")
    raw["jsonld"]["price"] = "99999.00"
    buybox = hepsiburada.parse(raw, KOZMIK).offers[0]
    assert buybox.why_not == "veri_uyusmazligi"
    assert any("uyuşmuyor" in note for note in buybox.notes)


def test_hepsiburada_wrong_gtin_means_the_product_changed(load_fixture):
    raw = load_fixture("hepsiburada", "HBCV00009Z3XL5")
    raw["jsonld"]["gtin"] = "0195950627999"
    assert hepsiburada.parse(raw, KOZMIK).status == STATUS_PRODUCT_CHANGED


def test_hepsiburada_captcha_is_reported_as_blocked():
    assert hepsiburada.parse({"challenge": "captcha"}, KOZMIK).status == STATUS_BLOCKED
