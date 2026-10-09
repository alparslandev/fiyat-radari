from radar.catalog import find_product
from radar.model import STATUS_BLOCKED, STATUS_OK, STATUS_PRODUCT_CHANGED
from radar.sites import amazon

KOZMIK = find_product("amazon", "B0FQFYN66J")
ABIS = find_product("amazon", "B0FQG1C99S")
GUMUS = find_product("amazon", "B0FQFTYPTQ")


def test_amazon_apple_premium_partner_qualifies(load_fixture):
    page = amazon.parse(load_fixture("amazon", "B0FQFYN66J"), KOZMIK)
    assert page.status == STATUS_OK
    offer = page.offers[0]
    assert (offer.seller, offer.effective, offer.basis, offer.qualifies) == ("Gürgençler Apple Premium Partner", 103869.0, "liste", True)
    assert offer.stock_hint == "Stokta sadece 6 adet kaldı."
    assert offer.key == "amazon:B0FQFYN66J:gurgencler-apple-premium-partner"


def test_amazon_unknown_third_party_seller_is_info_only(load_fixture):
    offer = amazon.parse(load_fixture("amazon", "B0FQG1C99S"), ABIS).offers[0]
    assert (offer.seller, offer.why_not) == ("Turkiye Magaza", "guvenilmeyen_satici")


def test_amazon_included_discount_is_a_note_not_a_coupon(load_fixture):
    offer = amazon.parse(load_fixture("amazon", "B0FQFTYPTQ"), GUMUS).offers[0]
    assert offer.effective == offer.price == 105973.11
    assert "Fiyata 2.024,89 TL Amazon indirimi dahil" in offer.notes


def test_amazon_coupon_amount_lowers_the_effective_price(load_fixture):
    raw = load_fixture("amazon", "B0FQFYN66J")
    raw["coupon"] = "1.000 TL kupon uygula"
    offer = amazon.parse(raw, KOZMIK).offers[0]
    assert (offer.effective, offer.basis) == (102869.0, "kupon")


def test_amazon_coupon_percent_lowers_the_effective_price(load_fixture):
    raw = load_fixture("amazon", "B0FQFYN66J")
    raw["coupon"] = "%5 kupon uygula"
    assert amazon.parse(raw, KOZMIK).offers[0].effective == round(103869 * 0.95, 2)


def test_amazon_prime_price_counts_for_a_prime_member(load_fixture):
    raw = load_fixture("amazon", "B0FQFYN66J")
    raw["prime"] = "Prime üyelerine özel fiyat: 99.999,00 TL"
    offer = amazon.parse(raw, KOZMIK).offers[0]
    assert (offer.effective, offer.basis) == (99999.0, "prime")


def test_amazon_importer_listing_is_disqualified(load_fixture):
    raw = load_fixture("amazon", "B0FQFYN66J")
    raw["productTitle"] = raw["productTitle"] + " (İthalatçı Garantili)"
    assert amazon.parse(raw, KOZMIK).offers[0].why_not == "garanti"


def test_amazon_pro_max_listing_means_the_product_changed(load_fixture):
    raw = load_fixture("amazon", "B0FQFYN66J")
    raw["productTitle"] = raw["productTitle"].replace("iPhone 17 Pro", "iPhone 17 Pro Max")
    assert amazon.parse(raw, KOZMIK).status == STATUS_PRODUCT_CHANGED


def test_amazon_page_without_price_but_out_of_stock_is_not_an_error(load_fixture):
    raw = load_fixture("amazon", "B0FQFYN66J")
    raw.update({"totalPrice": None, "priceToPay": None, "corePrice": None, "availability": "Şu anda mevcut değil.", "outOfStock": True})
    page = amazon.parse(raw, KOZMIK)
    assert (page.status, page.detail, page.offers) == (STATUS_OK, "stokta yok", [])


def test_amazon_continue_shopping_interstitial_is_blocked():
    assert amazon.parse({"challenge": "amazon_ara_sayfa"}, KOZMIK).status == STATUS_BLOCKED
