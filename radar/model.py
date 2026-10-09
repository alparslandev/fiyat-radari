from dataclasses import asdict, dataclass, field

STATUS_OK = "ok"
STATUS_BLOCKED = "engel"
STATUS_PRODUCT_CHANGED = "urun_degisti"
STATUS_ERROR = "hata"
STATUS_NO_DATA = "veri_yok"

STATUS_LABELS = {
    STATUS_OK: "çalışıyor",
    STATUS_BLOCKED: "bot koruması",
    STATUS_PRODUCT_CHANGED: "ürün değişti",
    STATUS_ERROR: "hata",
    STATUS_NO_DATA: "veri yok",
}


@dataclass(frozen=True)
class Offer:
    key: str
    site: str
    color: str
    seller: str
    seller_score: float | None
    price: float
    effective: float
    basis: str
    url: str
    in_stock: bool
    qualifies: bool
    why_not: str | None
    notes: tuple[str, ...] = ()
    stock_hint: str | None = None

    def to_json(self):
        data = asdict(self)
        data["notes"] = list(self.notes)
        return data


@dataclass
class PageResult:
    product_id: str
    color: str
    status: str
    detail: str = ""
    offers: list[Offer] = field(default_factory=list)
    duration_ms: int = 0


@dataclass
class SiteResult:
    site: str
    pages: list[PageResult] = field(default_factory=list)

    @property
    def status(self):
        changed = [page for page in self.pages if page.status == STATUS_PRODUCT_CHANGED]
        if changed:
            return STATUS_PRODUCT_CHANGED
        if any(page.status == STATUS_OK for page in self.pages):
            return STATUS_OK
        return self.pages[0].status if self.pages else STATUS_NO_DATA

    @property
    def pages_failed(self):
        return [page.product_id for page in self.pages if page.status != STATUS_OK]

    @property
    def detail(self):
        return "; ".join(f"{page.color}: {page.detail or STATUS_LABELS.get(page.status, page.status)}" for page in self.pages if page.status != STATUS_OK)

    @property
    def offers(self):
        return [offer for page in self.pages for offer in page.offers]

    def best_qualifying(self):
        candidates = [offer for offer in self.offers if offer.qualifies]
        return min(candidates, key=lambda offer: offer.effective) if candidates else None

    def to_json(self):
        return {
            "status": self.status,
            "detail": self.detail,
            "pages_ok": sum(1 for page in self.pages if page.status == STATUS_OK),
            "pages_total": len(self.pages),
            "pages_failed": self.pages_failed,
            "offers": [offer.to_json() for offer in self.offers],
        }
