from urllib.parse import quote

from ..model import STATUS_BLOCKED, STATUS_NO_DATA, STATUS_OK, STATUS_PRODUCT_CHANGED, Offer, PageResult
from ..money import format_tl, normalize_gtin, parse_amount
from ..policy import REQUIRED_CAPACITY, qualification
from .common import ready_js, with_helpers

SITE = "hepsiburada"
PRICE_MISMATCH_TOLERANCE = 1.0

READY_JS = ready_js("!!(window.productModel && window.productModel.product && window.productModel.product.currentListing)")

EXTRACT_JS = with_helpers(r"""() => {
  const challenge = (__CHALLENGE__)();
  const nodes = (__JSONLD__)();
  const ld = nodes.find((node) => node['@type'] === 'Product') || null;
  const offer = ld ? (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers) : null;
  const model = window.productModel && window.productModel.product;
  const listing = (item) => item ? {
    merchantId: item.merchantId,
    merchantName: item.merchantName,
    listingId: item.listingId,
    prices: (item.prices || []).map((p) => ({ value: p.value, discountRate: p.discountRate })),
    isSalable: item.isSalable,
    minimumPrice: item.minimumPrice,
    originalPrice: item.originalPrice,
    rating: item.ratingSummary ? item.ratingSummary.lifetimeRating : null,
  } : null;
  const text = document.body ? document.body.innerText : '';
  const warranty = (text.match(/Garanti Tipi[ \t]*\n?[ \t]*([^\n\t]+)/) || [])[1] || null;
  return {
    challenge,
    title: document.title,
    jsonld: ld ? {
      name: ld.name,
      sku: ld.sku,
      gtin: ld.gtin13 || ld.gtin || null,
      color: ld.color || null,
      price: offer ? offer.price : null,
      availability: offer ? offer.availability : null,
    } : null,
    current: model ? listing(model.currentListing) : null,
    listings: model && model.listings ? model.listings.map(listing) : [],
    warranty,
  };
}""")


def _listing_prices(listing):
    amounts = [parse_amount(entry.get("value")) for entry in (listing or {}).get("prices") or []]
    return [amount for amount in amounts if amount is not None]


def _offer(product, merchant, score, prices, in_stock, warranty_ok, url, notes, data_problem=None):
    shown = min(prices)
    qualifies, why_not = qualification(SITE, merchant, score, shown, in_stock, warranty_ok)
    if data_problem:
        qualifies, why_not = False, data_problem
    return Offer(
        key=f"{SITE}:{product.product_id}:{merchant}",
        site=SITE,
        color=product.color,
        seller=merchant,
        seller_score=score,
        price=shown,
        effective=shown,
        basis="liste",
        url=url,
        in_stock=in_stock,
        qualifies=qualifies,
        why_not=why_not,
        notes=tuple(notes),
    )


def parse(raw, product):
    if raw.get("challenge"):
        return PageResult(product.product_id, product.color, STATUS_BLOCKED, raw["challenge"])
    ld = raw.get("jsonld")
    if not ld:
        return PageResult(product.product_id, product.color, STATUS_NO_DATA, "ürün verisi bulunamadı")
    identity_problems = []
    if ld.get("sku") != product.product_id:
        identity_problems.append(f"ürün kimliği {ld.get('sku')}")
    if normalize_gtin(ld.get("gtin")) != normalize_gtin(product.gtin):
        identity_problems.append(f"barkod {ld.get('gtin')}")
    if REQUIRED_CAPACITY not in (ld.get("name") or ""):
        identity_problems.append(f"ad {ld.get('name')}")
    if identity_problems:
        return PageResult(product.product_id, product.color, STATUS_PRODUCT_CHANGED, ", ".join(identity_problems))
    warranty_ok = "Apple Türkiye" in (raw.get("warranty") or "")
    current = raw.get("current") or {}
    ld_price = parse_amount(ld.get("price"))
    buybox_prices = _listing_prices(current) or ([ld_price] if ld_price is not None else [])
    if not buybox_prices:
        return PageResult(product.product_id, product.color, STATUS_NO_DATA, "fiyat bulunamadı")
    buybox_in_stock = str(ld.get("availability") or "").endswith("InStock")
    buybox_notes = []
    data_problem = None
    shown_price = min(buybox_prices)
    if ld_price is not None and abs(ld_price - shown_price) > PRICE_MISMATCH_TOLERANCE:
        buybox_notes.append(f"Sayfa verileri uyuşmuyor ({format_tl(ld_price)} / {format_tl(shown_price)})")
        data_problem = "veri_uyusmazligi"
    merchant = current.get("merchantName") or "Hepsiburada"
    offers = [_offer(product, merchant, current.get("rating"), buybox_prices, buybox_in_stock, warranty_ok, product.url, buybox_notes, data_problem)]
    for listing in raw.get("listings") or []:
        prices = _listing_prices(listing)
        name = listing.get("merchantName")
        if not prices or not name or name == merchant:
            continue
        url = f"{product.url}?magaza={quote(name)}"
        offers.append(_offer(product, name, listing.get("rating"), prices, listing.get("isSalable") is True, warranty_ok, url, []))
    return PageResult(product.product_id, product.color, STATUS_OK, "", offers)
