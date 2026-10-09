import re

from ..model import STATUS_BLOCKED, STATUS_NO_DATA, STATUS_OK, STATUS_PRODUCT_CHANGED, Offer, PageResult
from ..money import format_tl, parse_amount
from ..policy import REQUIRED_CAPACITY, is_platform_seller, qualification, tr_lower
from .common import ready_js, with_helpers

SITE = "amazon"
OUT_OF_STOCK_MARKERS = ("şu anda mevcut değil", "stokta yok", "mevcut değil")

READY_JS = ready_js("!!document.querySelector('#productTitle') && !!document.querySelector('#tp_price_block_total_price_ww .a-offscreen, #corePriceDisplay_desktop_feature_div .priceToPay .a-price-whole, #corePrice_feature_div .a-offscreen, #outOfStock')")

EXTRACT_JS = with_helpers(r"""() => {
  const challenge = (__CHALLENGE__)();
  const text = (selector) => {
    const element = document.querySelector(selector);
    return element ? element.textContent.replace(/\s+/g, ' ').trim() : null;
  };
  const priceToPay = (() => {
    const element = document.querySelector('#corePriceDisplay_desktop_feature_div .priceToPay');
    if (!element) return null;
    const whole = element.querySelector('.a-price-whole');
    const fraction = element.querySelector('.a-price-fraction');
    if (!whole) return null;
    const wholeText = whole.textContent.replace(/[^\d.,]/g, '').replace(/[.,]$/, '');
    return fraction ? wholeText + ',' + fraction.textContent.replace(/\D/g, '') : wholeText;
  })();
  return {
    challenge,
    title: document.title,
    asin: (location.pathname.match(/\/dp\/([A-Z0-9]{10})/) || [])[1] || null,
    productTitle: text('#productTitle'),
    color: text('#variation_color_name .selection') || text('#inline-twister-expanded-dimension-text-color_name'),
    totalPrice: text('#tp_price_block_total_price_ww .a-offscreen'),
    priceToPay,
    corePrice: text('#corePrice_feature_div .a-offscreen'),
    seller: text('#sellerProfileTriggerId') || text('#merchantInfoFeature_feature_div .offer-display-feature-text-message'),
    shipper: text('#fulfillerInfoFeature_feature_div .offer-display-feature-text-message'),
    availability: text('#availability'),
    outOfStock: !!document.querySelector('#outOfStock'),
    promo: text('#promoMessagingDiscountValue_feature_div'),
    promoBlock: text('#promoPriceBlockMessage_feature_div'),
    coupon: text('#couponBadgeRegularVpc') || text('[id^="couponText"]'),
    prime: text('#primeExclusivePricingMessage') || text('#pep-signup-link'),
    otherOffers: text('#aod-ingress-link'),
  };
}""")

COUPON_AMOUNT = re.compile(r"([\d.,]+)\s*TL[^%]{0,40}?kupon|kupon[^%\d]{0,40}?([\d.,]+)\s*TL", re.I)
COUPON_PERCENT = re.compile(r"%\s*(\d{1,2})[^%]{0,40}?kupon|kupon[^%]{0,40}?%\s*(\d{1,2})", re.I)
PRIME_AMOUNT = re.compile(r"prime[^\d]{0,60}?([\d.,]+)\s*TL", re.I)


def _coupon_price(price, texts):
    for text in texts:
        if not text:
            continue
        match = COUPON_AMOUNT.search(text)
        if match:
            amount = parse_amount(match.group(1) or match.group(2))
            if amount and 0 < amount < price:
                return price - amount
        match = COUPON_PERCENT.search(text)
        if match:
            percent = int(match.group(1) or match.group(2))
            if 0 < percent < 50:
                return round(price * (100 - percent) / 100, 2)
    return None


def _prime_price(price, text):
    match = PRIME_AMOUNT.search(text or "")
    if not match:
        return None
    amount = parse_amount(match.group(1))
    return amount if amount and amount < price else None


INCLUDED_DISCOUNT = re.compile(r"([\d.,]+)\s*TL.{0,40}?indirimi dahil", re.I)
REPEATED_AMOUNT = re.compile(r"([\d.,]+\s?TL)\1")


def _tidy(text):
    return REPEATED_AMOUNT.sub(r"\1", re.sub(r"\s+", " ", text or "")).strip()


def _included_discount(text):
    match = INCLUDED_DISCOUNT.search(_tidy(text))
    return parse_amount(match.group(1)) if match else None


def _in_stock(raw):
    if raw.get("outOfStock"):
        return False
    availability = tr_lower(raw.get("availability"))
    return not any(marker in availability for marker in OUT_OF_STOCK_MARKERS)


TURKISH_TO_ASCII = str.maketrans("çğıöşü", "cgiosu")


def _seller_key(seller):
    return re.sub(r"[^a-z0-9]+", "-", tr_lower(seller).translate(TURKISH_TO_ASCII)).strip("-") or "bilinmiyor"


def parse(raw, product):
    if raw.get("challenge"):
        return PageResult(product.product_id, product.color, STATUS_BLOCKED, raw["challenge"])
    title = raw.get("productTitle")
    if not title:
        return PageResult(product.product_id, product.color, STATUS_NO_DATA, "ürün verisi bulunamadı")
    identity_problems = []
    if raw.get("asin") and raw["asin"] != product.product_id:
        identity_problems.append(f"ASIN {raw['asin']}")
    if "iphone 17 pro" not in tr_lower(title) or "pro max" in tr_lower(title):
        identity_problems.append("model")
    if f"{REQUIRED_CAPACITY} gb" not in tr_lower(title):
        identity_problems.append("hafıza")
    if identity_problems:
        return PageResult(product.product_id, product.color, STATUS_PRODUCT_CHANGED, ", ".join(identity_problems))
    price = parse_amount(raw.get("totalPrice")) or parse_amount(raw.get("priceToPay")) or parse_amount(raw.get("corePrice"))
    if price is None:
        detail = "stokta yok" if not _in_stock(raw) else "fiyat bulunamadı"
        status = STATUS_OK if detail == "stokta yok" else STATUS_NO_DATA
        return PageResult(product.product_id, product.color, status, detail)
    seller = raw.get("seller") or "Amazon.com.tr"
    in_stock = _in_stock(raw)
    warranty_ok = "ithalatçı" not in tr_lower(title)
    counted = []
    coupon = _coupon_price(price, [raw.get("coupon"), raw.get("promoBlock"), raw.get("promo")])
    if coupon is not None:
        counted.append(("kupon", coupon))
    prime = _prime_price(price, raw.get("prime"))
    if prime is not None:
        counted.append(("prime", prime))
    effective, basis = price, "liste"
    for kind, amount in counted:
        if amount < effective:
            effective, basis = amount, kind
    qualifies, why_not = qualification(SITE, seller, None, effective, in_stock, warranty_ok)
    notes = []
    shipper = raw.get("shipper")
    if shipper and shipper != seller and not is_platform_seller(SITE, seller):
        notes.append(f"Gönderici: {shipper}")
    included = _included_discount(raw.get("promo"))
    if included:
        notes.append(f"Fiyata {format_tl(included)} Amazon indirimi dahil")
    elif raw.get("promo"):
        notes.append(f"Kampanya: {_tidy(raw['promo'])[:120]}")
    for label, value in (("Kupon", raw.get("coupon")), ("Prime", raw.get("prime")), ("Fiyat notu", raw.get("promoBlock"))):
        if value:
            notes.append(f"{label}: {_tidy(value)[:120]}")
    if raw.get("otherOffers"):
        notes.append(f"Diğer satıcılar: {_tidy(raw['otherOffers'])[:80]}")
    availability = raw.get("availability") or ""
    stock_hint = availability if "sadece" in tr_lower(availability) else None
    offer = Offer(
        key=f"{SITE}:{product.product_id}:{_seller_key(seller)}",
        site=SITE,
        color=product.color,
        seller=seller,
        seller_score=None,
        price=price,
        effective=effective,
        basis=basis,
        url=product.url,
        in_stock=in_stock,
        qualifies=qualifies,
        why_not=why_not,
        notes=tuple(notes),
        stock_hint=stock_hint,
    )
    return PageResult(product.product_id, product.color, STATUS_OK, "", [offer])
