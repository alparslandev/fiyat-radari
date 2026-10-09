from radar.catalog import find_product
from radar.model import STATUS_BLOCKED, STATUS_OK, STATUS_PRODUCT_CHANGED
from radar.sites import trendyol

KOZMIK = find_product("trendyol", "985256852")


def _offers_by_seller(page):
    return {offer.seller: offer for offer in page.offers}


def test_trendyol_reads_the_winner_and_every_other_merchant(load_fixture):
    raw = load_fixture("trendyol", "985256852")
    page = trendyol.parse(raw, KOZMIK)
    assert page.status == STATUS_OK
    assert len(page.offers) == 1 + len(raw["others"])
    winner = page.offers[0]
    assert (winner.seller, winner.effective, winner.qualifies) == ("Trendyol", 105084.12, True)
    assert winner.url.endswith("?merchantId=968")
    assert winner.key == "trendyol:985256852:968"


def test_trendyol_other_merchant_links_are_absolute(load_fixture):
    page = trendyol.parse(load_fixture("trendyol", "985256852"), KOZMIK)
    partner = _offers_by_seller(page)["Gürgençler Apple Yetkili Satıcı"]
    assert partner.url.startswith("https://www.trendyol.com/apple/iphone-17-pro-256gb-kozmik-turuncu-p-985256852?")
    assert partner.qualifies


def test_trendyol_zero_score_seller_is_info_only(load_fixture):
    page = trendyol.parse(load_fixture("trendyol", "985256852"), KOZMIK)
    assert _offers_by_seller(page)["Amanoslar Ev Concept"].why_not == "dusuk_puan"


def test_trendyol_basket_and_coupon_prices_count_but_plus_is_only_a_note(load_fixture):
    raw = load_fixture("trendyol", "985256852")
    raw["winner"]["price"].update({"discounted": 104000, "coupon": 103500, "plus": 100000, "noLimit": 103500})
    winner = trendyol.parse(raw, KOZMIK).offers[0]
    assert (winner.price, winner.effective, winner.basis) == (105084.12, 103500, "kupon")
    assert winner.notes == ("Trendyol Plus ile 100.000 TL",)


def test_trendyol_importer_warranty_disqualifies_every_offer(load_fixture):
    raw = load_fixture("trendyol", "985256852")
    raw["product"]["attributes"] = [["Garanti Tipi", "İthalatçı Garantili"] if name == "Garanti Tipi" else [name, value] for name, value in raw["product"]["attributes"]]
    page = trendyol.parse(raw, KOZMIK)
    assert page.status == STATUS_OK
    assert {offer.why_not for offer in page.offers} == {"garanti"}


def test_trendyol_wrong_barcode_means_the_product_changed(load_fixture):
    raw = load_fixture("trendyol", "985256852")
    raw["winner"]["barcode"] = "195950627999"
    page = trendyol.parse(raw, KOZMIK)
    assert page.status == STATUS_PRODUCT_CHANGED
    assert page.offers == []


def test_trendyol_running_out_and_flash_flags_reach_the_offer(load_fixture):
    raw = load_fixture("trendyol", "985256852")
    raw["winner"].update({"isRunningOut": True, "runningOutQuantity": 3, "isFlash": True})
    winner = trendyol.parse(raw, KOZMIK).offers[0]
    assert winner.stock_hint == "Tükenmek üzere (3 adet)"
    assert "Flaş ürün" in winner.notes


def test_trendyol_challenge_page_is_reported_as_blocked():
    page = trendyol.parse({"challenge": "cloudflare", "title": "Bir dakika lütfen..."}, KOZMIK)
    assert (page.status, page.detail) == (STATUS_BLOCKED, "cloudflare")
