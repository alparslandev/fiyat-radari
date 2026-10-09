from urllib.parse import urljoin

from ..model import STATUS_BLOCKED, STATUS_NO_DATA, STATUS_OK, STATUS_PRODUCT_CHANGED, Offer, PageResult
from ..money import normalize_gtin
from ..policy import REQUIRED_CAPACITY, WARRANTY, effective_price, lower_info_notes, qualification
from .common import ready_js, with_helpers

SITE = "trendyol"
BASE_URL = "https://www.trendyol.com"

READY_JS = ready_js("!!(window['__envoy__SHARED_PROPS'] && window['__envoy__SHARED_PROPS'].product && window['__envoy__SHARED_PROPS'].product.merchantListing)")

EXTRACT_JS = with_helpers(r"""() => {
  const challenge = (__CHALLENGE__)();
  const props = window['__envoy__SHARED_PROPS'];
  const product = props && props.product;
  if (!product) return { challenge, title: document.title };
  const amount = (part) => (part && typeof part.value === 'number' ? part.value : null);
  const price = (p) => p ? {
    selling: amount(p.sellingPrice),
    discounted: amount(p.discountedPrice),
    coupon: amount(p.couponApplicablePrice),
    plus: amount(p.tyPlusCouponApplicablePrice),
    noLimit: amount(p.discountedPriceAfterNoLimitPromotions),
    original: amount(p.originalPrice),
  } : null;
  const score = (merchant) => (merchant && merchant.sellerScore && typeof merchant.sellerScore.value === 'number' ? merchant.sellerScore.value : null);
  const listing = product.merchantListing || {};
  const winner = listing.winnerVariant || {};
  return {
    challenge,
    title: document.title,
    product: {
      id: product.id,
      name: product.name,
      inStock: product.inStock,
      attributes: (product.attributes || []).map((a) => [a.key && a.key.name, a.value && a.value.name]),
    },
    winner: listing.merchant ? {
      id: listing.merchant.id,
      name: listing.merchant.name,
      score: score(listing.merchant),
      price: price(winner.price),
      inStock: winner.inStock,
      sellable: winner.sellable,
      barcode: winner.barcode,
      isFlash: winner.isFlash,
      isRunningOut: winner.isRunningOut,
      runningOutQuantity: winner.runningOutQuantity,
    } : null,
    others: (listing.otherMerchants || []).map((merchant) => {
      const variant = (merchant.variants || [])[0] || {};
      return {
        id: merchant.id,
        name: merchant.name,
        score: score(merchant),
        price: price(merchant.price || variant.price),
        inStock: variant.inStock,
        sellable: variant.sellable,
        url: merchant.url,
      };
    }),
  };
}""")


def _offer(product, merchant, url, warranty_ok, stock_hint, extra_notes):
    prices = merchant.get("price") or {}
    public = prices.get("selling")
    if public is None:
        return None
    effective, basis = effective_price(public, [("sepette", prices.get("discounted")), ("kupon", prices.get("coupon"))])
    in_stock = merchant.get("inStock") is not False and merchant.get("sellable") is not False
    score = merchant.get("score")
    qualifies, why_not = qualification(SITE, merchant.get("name") or "", score, effective, in_stock, warranty_ok)
    notes = lower_info_notes(effective, [("Trendyol Plus ile", prices.get("plus")), ("Ek kampanya koşuluyla", prices.get("noLimit"))])
    return Offer(
        key=f"{SITE}:{product.product_id}:{merchant.get('id')}",
        site=SITE,
        color=product.color,
        seller=merchant.get("name") or "?",
        seller_score=score,
        price=public,
        effective=effective,
        basis=basis,
        url=url,
        in_stock=in_stock,
        qualifies=qualifies,
        why_not=why_not,
        notes=tuple(extra_notes + notes),
        stock_hint=stock_hint,
    )


def _winner_stock_hint(winner):
    if not winner.get("isRunningOut"):
        return None
    quantity = winner.get("runningOutQuantity")
    return f"Tükenmek üzere ({quantity} adet)" if quantity else "Tükenmek üzere"


def parse(raw, product):
    if raw.get("challenge"):
        return PageResult(product.product_id, product.color, STATUS_BLOCKED, raw["challenge"])
    data = raw.get("product")
    winner = raw.get("winner")
    if not data or not winner:
        return PageResult(product.product_id, product.color, STATUS_NO_DATA, "ürün verisi bulunamadı")
    attributes = {name: value for name, value in data.get("attributes") or [] if name}
    identity_problems = []
    if str(data.get("id")) != product.product_id:
        identity_problems.append(f"ürün kimliği {data.get('id')}")
    if normalize_gtin(winner.get("barcode")) != normalize_gtin(product.gtin):
        identity_problems.append(f"barkod {winner.get('barcode')}")
    if REQUIRED_CAPACITY not in (attributes.get("Dahili Hafıza") or ""):
        identity_problems.append(f"hafıza {attributes.get('Dahili Hafıza')}")
    if identity_problems:
        return PageResult(product.product_id, product.color, STATUS_PRODUCT_CHANGED, ", ".join(identity_problems))
    warranty_ok = attributes.get("Garanti Tipi") == WARRANTY
    offers = []
    winner_notes = ["Flaş ürün"] if winner.get("isFlash") else []
    winner_offer = _offer(product, winner, f"{product.url}?merchantId={winner.get('id')}", warranty_ok, _winner_stock_hint(winner), winner_notes)
    if winner_offer:
        offers.append(winner_offer)
    for other in raw.get("others") or []:
        url = urljoin(BASE_URL, other.get("url") or "") if other.get("url") else f"{product.url}?merchantId={other.get('id')}"
        offer = _offer(product, other, url, warranty_ok, None, [])
        if offer:
            offers.append(offer)
    if not offers:
        return PageResult(product.product_id, product.color, STATUS_NO_DATA, "fiyat bulunamadı")
    return PageResult(product.product_id, product.color, STATUS_OK, "", offers)
