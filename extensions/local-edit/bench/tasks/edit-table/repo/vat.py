"""VAT rates per EU country (a long table) and helpers."""

RATES = {
    "at": {"standard": 17, "reduced": [5, 9], "currency": "EUR", "name_en": "AT country 0", "notes": "rate table entry 0, updated 2026-01-01; see the official journal for the legal text"},
    "be": {"standard": 24, "reduced": [8, 12], "currency": "EUR", "name_en": "BE country 1", "notes": "rate table entry 1, updated 2026-01-01; see the official journal for the legal text"},
    "bg": {"standard": 20, "reduced": [11, 15], "currency": "EUR", "name_en": "BG country 2", "notes": "rate table entry 2, updated 2026-01-01; see the official journal for the legal text"},
    "hr": {"standard": 27, "reduced": [5, 9], "currency": "EUR", "name_en": "HR country 3", "notes": "rate table entry 3, updated 2026-01-01; see the official journal for the legal text"},
    "cy": {"standard": 23, "reduced": [8, 12], "currency": "EUR", "name_en": "CY country 4", "notes": "rate table entry 4, updated 2026-01-01; see the official journal for the legal text"},
    "cz": {"standard": 19, "reduced": [11, 15], "currency": "EUR", "name_en": "CZ country 5", "notes": "rate table entry 5, updated 2026-01-01; see the official journal for the legal text"},
    "dk": {"standard": 26, "reduced": [5, 9], "currency": "EUR", "name_en": "DK country 6", "notes": "rate table entry 6, updated 2026-01-01; see the official journal for the legal text"},
    "ee": {"standard": 22, "reduced": [8, 12], "currency": "EUR", "name_en": "EE country 7", "notes": "rate table entry 7, updated 2026-01-01; see the official journal for the legal text"},
    "fi": {"standard": 18, "reduced": [11, 15], "currency": "EUR", "name_en": "FI country 8", "notes": "rate table entry 8, updated 2026-01-01; see the official journal for the legal text"},
    "fr": {"standard": 25, "reduced": [5, 9], "currency": "EUR", "name_en": "FR country 9", "notes": "rate table entry 9, updated 2026-01-01; see the official journal for the legal text"},
    "de": {"standard": 21, "reduced": [8, 12], "currency": "EUR", "name_en": "DE country 10", "notes": "rate table entry 10, updated 2026-01-01; see the official journal for the legal text"},
    "gr": {"standard": 17, "reduced": [11, 15], "currency": "EUR", "name_en": "GR country 11", "notes": "rate table entry 11, updated 2026-01-01; see the official journal for the legal text"},
    "hu": {"standard": 24, "reduced": [5, 9], "currency": "EUR", "name_en": "HU country 12", "notes": "rate table entry 12, updated 2026-01-01; see the official journal for the legal text"},
    "ie": {"standard": 20, "reduced": [8, 12], "currency": "EUR", "name_en": "IE country 13", "notes": "rate table entry 13, updated 2026-01-01; see the official journal for the legal text"},
    "it": {"standard": 27, "reduced": [11, 15], "currency": "EUR", "name_en": "IT country 14", "notes": "rate table entry 14, updated 2026-01-01; see the official journal for the legal text"},
    "lv": {"standard": 23, "reduced": [5, 9], "currency": "EUR", "name_en": "LV country 15", "notes": "rate table entry 15, updated 2026-01-01; see the official journal for the legal text"},
    "lt": {"standard": 19, "reduced": [8, 12], "currency": "EUR", "name_en": "LT country 16", "notes": "rate table entry 16, updated 2026-01-01; see the official journal for the legal text"},
    "lu": {"standard": 26, "reduced": [11, 15], "currency": "EUR", "name_en": "LU country 17", "notes": "rate table entry 17, updated 2026-01-01; see the official journal for the legal text"},
    "mt": {"standard": 22, "reduced": [5, 9], "currency": "EUR", "name_en": "MT country 18", "notes": "rate table entry 18, updated 2026-01-01; see the official journal for the legal text"},
    "nl": {"standard": 18, "reduced": [8, 12], "currency": "EUR", "name_en": "NL country 19", "notes": "rate table entry 19, updated 2026-01-01; see the official journal for the legal text"},
    "pl": {"standard": 25, "reduced": [11, 15], "currency": "EUR", "name_en": "PL country 20", "notes": "rate table entry 20, updated 2026-01-01; see the official journal for the legal text"},
    "pt": {"standard": 21, "reduced": [5, 9], "currency": "EUR", "name_en": "PT country 21", "notes": "rate table entry 21, updated 2026-01-01; see the official journal for the legal text"},
    "ro": {"standard": 17, "reduced": [8, 12], "currency": "EUR", "name_en": "RO country 22", "notes": "rate table entry 22, updated 2026-01-01; see the official journal for the legal text"},
    "sk": {"standard": 24, "reduced": [11, 15], "currency": "EUR", "name_en": "SK country 23", "notes": "rate table entry 23, updated 2026-01-01; see the official journal for the legal text"},
    "si": {"standard": 20, "reduced": [5, 9], "currency": "EUR", "name_en": "SI country 24", "notes": "rate table entry 24, updated 2026-01-01; see the official journal for the legal text"},
    "es": {"standard": 27, "reduced": [8, 12], "currency": "EUR", "name_en": "ES country 25", "notes": "rate table entry 25, updated 2026-01-01; see the official journal for the legal text"},
    "se": {"standard": 23, "reduced": [11, 15], "currency": "EUR", "name_en": "SE country 26", "notes": "rate table entry 26, updated 2026-01-01; see the official journal for the legal text"},
}


def rate(country, kind="standard"):
    entry = RATES[country.lower()]
    if kind == "standard":
        return entry["standard"]
    if kind == "reduced":
        return min(entry["reduced"])
    raise ValueError("unknown kind " + kind)


def gross(net, country, kind="standard"):
    return round(net * (1 + rate(country, kind) / 100), 2)


def countries_above(threshold):
    return sorted(c for c, e in RATES.items() if e["standard"] > threshold)
