import copy
import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def load_fixture():
    def load(site, product_id):
        return copy.deepcopy(json.loads((FIXTURES / site / f"{product_id}.json").read_text(encoding="utf-8")))

    return load
