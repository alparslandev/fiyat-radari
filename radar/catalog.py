from dataclasses import dataclass

SITES = ("trendyol", "hepsiburada", "amazon")

SITE_NAMES = {"trendyol": "Trendyol", "hepsiburada": "Hepsiburada", "amazon": "Amazon"}

WARMUP_URLS = {"amazon": "https://www.amazon.com.tr/"}

COUNTRY_CHOICE_COOKIES = {
    "trendyol": (
        {"name": "storefrontId", "value": "1", "domain": ".trendyol.com", "path": "/"},
        {"name": "countryCode", "value": "TR", "domain": ".trendyol.com", "path": "/"},
        {"name": "language", "value": "tr", "domain": ".trendyol.com", "path": "/"},
    ),
}

RELOAD_ONCE_WHEN_BLOCKED = {"amazon"}


@dataclass(frozen=True)
class Product:
    site: str
    color: str
    url: str
    product_id: str
    gtin: str


CATALOG = (
    Product("trendyol", "Gümüş", "https://www.trendyol.com/apple/iphone-17-pro-256gb-gumus-p-985256847", "985256847", "195950627206"),
    Product("trendyol", "Abis", "https://www.trendyol.com/apple/iphone-17-pro-256gb-5g-deep-blue-p-990828141", "990828141", "195950627602"),
    Product("trendyol", "Kozmik Turuncu", "https://www.trendyol.com/apple/iphone-17-pro-256gb-kozmik-turuncu-p-985256852", "985256852", "195950627404"),
    Product("hepsiburada", "Gümüş", "https://www.hepsiburada.com/apple-iphone-17-pro-256-gb-gumus-p-HBCV00009Z40DM", "HBCV00009Z40DM", "195950627206"),
    Product("hepsiburada", "Abis", "https://www.hepsiburada.com/apple-iphone-17-pro-256-gb-abis-p-HBCV00009Z3YPK", "HBCV00009Z3YPK", "195950627602"),
    Product("hepsiburada", "Kozmik Turuncu", "https://www.hepsiburada.com/apple-iphone-17-pro-256-gb-kozmik-turuncu-p-HBCV00009Z3XL5", "HBCV00009Z3XL5", "195950627404"),
    Product("amazon", "Gümüş", "https://www.amazon.com.tr/dp/B0FQFTYPTQ", "B0FQFTYPTQ", "195950627206"),
    Product("amazon", "Abis", "https://www.amazon.com.tr/dp/B0FQG1C99S", "B0FQG1C99S", "195950627602"),
    Product("amazon", "Kozmik Turuncu", "https://www.amazon.com.tr/dp/B0FQFYN66J", "B0FQFYN66J", "195950627404"),
)


def products_for(site):
    return [product for product in CATALOG if product.site == site]


def find_product(site, product_id):
    for product in CATALOG:
        if product.site == site and product.product_id == product_id:
            return product
    raise KeyError(f"{site}:{product_id}")
