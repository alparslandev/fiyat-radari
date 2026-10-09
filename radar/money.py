import re


def parse_amount(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    raw = re.sub(r"[^\d.,]", "", str(value)).strip(".,")
    if not raw:
        return None
    if "," in raw and "." in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif "," in raw:
        head, _, tail = raw.rpartition(",")
        raw = f"{head.replace(',', '')}.{tail}" if len(tail) == 2 else raw.replace(",", "")
    elif raw.count(".") == 1 and len(raw.rpartition(".")[2]) == 3:
        raw = raw.replace(".", "")
    elif raw.count(".") > 1:
        raw = raw.replace(".", "", raw.count(".") - 1)
    try:
        return float(raw)
    except ValueError:
        return None


def format_tl(amount):
    if amount is None:
        return "-"
    whole = int(amount)
    cents = round((amount - whole) * 100)
    if cents == 100:
        whole, cents = whole + 1, 0
    grouped = f"{whole:,}".replace(",", ".")
    return f"{grouped},{cents:02d} TL" if cents else f"{grouped} TL"


def normalize_gtin(value):
    return str(value or "").strip().lstrip("0")
