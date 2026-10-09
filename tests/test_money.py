import pytest

from radar.money import format_tl, normalize_gtin, parse_amount


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("103.869,00 TL", 103869.0),
        ("105.973,11", 105973.11),
        ("2.024.89TL", 2024.89),
        ("107999.00", 107999.0),
        ("103.869", 103869.0),
        (105913.12, 105913.12),
        ("118.999 TL", 118999.0),
    ],
)
def test_parse_amount_reads_turkish_and_feed_formats(text, expected):
    assert parse_amount(text) == expected


@pytest.mark.parametrize("text", [None, "", "TL", True])
def test_parse_amount_rejects_non_amounts(text):
    assert parse_amount(text) is None


def test_format_tl_drops_zero_kurus():
    assert format_tl(103869) == "103.869 TL"
    assert format_tl(105913.12) == "105.913,12 TL"
    assert format_tl(None) == "-"


def test_normalize_gtin_ignores_leading_zeros():
    assert normalize_gtin("0195950627206") == normalize_gtin("195950627206")
