from radar.policy import MIN_SELLER_SCORE, effective_price, lower_info_notes, qualification


def test_platform_sellers_qualify_without_a_score():
    assert qualification("trendyol", "Trendyol", None, 105000, True, True) == (True, None)
    assert qualification("hepsiburada", "Hepsiburada", None, 105000, True, True) == (True, None)
    assert qualification("amazon", "Amazon.com.tr", None, 105000, True, True) == (True, None)


def test_amazon_accepts_only_apple_premium_partners_among_third_parties():
    assert qualification("amazon", "Gürgençler Apple Premium Partner", None, 103869, True, True) == (True, None)
    assert qualification("amazon", "Turkiye Magaza", None, 105349, True, True) == (False, "guvenilmeyen_satici")


def test_marketplace_sellers_need_a_score_of_at_least_the_floor():
    assert qualification("trendyol", "TekCep", MIN_SELLER_SCORE, 105000, True, True) == (True, None)
    assert qualification("trendyol", "Amanoslar Ev Concept", 0, 105000, True, True) == (False, "dusuk_puan")
    assert qualification("hepsiburada", "Yeni Satıcı", None, 105000, True, True) == (False, "puansiz_satici")


def test_warranty_stock_and_price_band_come_before_the_seller():
    assert qualification("trendyol", "Trendyol", 9.3, 105000, True, False) == (False, "garanti")
    assert qualification("trendyol", "Trendyol", 9.3, 105000, False, True) == (False, "stok_yok")
    assert qualification("trendyol", "Trendyol", 9.3, 10500, True, True) == (False, "fiyat_bandi")


def test_effective_price_takes_the_lowest_counted_price_below_the_list_price():
    assert effective_price(105000, [("sepette", 104000), ("kupon", 103500)]) == (103500, "kupon")
    assert effective_price(105000, [("sepette", None), ("kupon", 0), ("prime", 106000)]) == (105000, "liste")


def test_uncounted_prices_become_notes_only_when_lower():
    assert lower_info_notes(105000, [("Trendyol Plus ile", 100000), ("Ek kampanya koşuluyla", 105000)]) == ["Trendyol Plus ile 100.000 TL"]
