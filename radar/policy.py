from .money import format_tl

PRICE_MIN = 40_000
PRICE_MAX = 200_000
MIN_SELLER_SCORE = 8.5
WARRANTY = "Apple Türkiye Garantili"
REQUIRED_CAPACITY = "256"

PLATFORM_SELLERS = {
    "trendyol": ("trendyol",),
    "hepsiburada": ("hepsiburada",),
    "amazon": ("amazon.com.tr", "amazon"),
}

AMAZON_TRUSTED_MARKERS = ("apple premium partner",)

COUNTED_BASES = ("sepette", "kupon", "prime")


def tr_lower(text):
    return (text or "").replace("İ", "i").replace("I", "ı").lower()


def is_platform_seller(site, seller):
    return tr_lower(seller).strip() in PLATFORM_SELLERS.get(site, ())


def seller_problem(site, seller, score):
    if is_platform_seller(site, seller):
        return None
    if site == "amazon":
        trusted = any(marker in tr_lower(seller) for marker in AMAZON_TRUSTED_MARKERS)
        return None if trusted else "guvenilmeyen_satici"
    if score is None:
        return "puansiz_satici"
    if score < MIN_SELLER_SCORE:
        return "dusuk_puan"
    return None


def qualification(site, seller, score, effective, in_stock, warranty_ok):
    if not warranty_ok:
        return False, "garanti"
    if not in_stock:
        return False, "stok_yok"
    if not PRICE_MIN <= effective <= PRICE_MAX:
        return False, "fiyat_bandi"
    problem = seller_problem(site, seller, score)
    if problem:
        return False, problem
    return True, None


def effective_price(public, counted):
    best, basis = public, "liste"
    for kind, amount in counted:
        if amount is not None and 0 < amount < best:
            best, basis = amount, kind
    return best, basis


def lower_info_notes(effective, uncounted):
    notes = []
    for label, amount in uncounted:
        if amount is not None and 0 < amount < effective:
            notes.append(f"{label} {format_tl(amount)}")
    return notes
