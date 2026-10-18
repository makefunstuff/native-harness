// VAT rates per EU country (a long table) and helpers.

export interface Entry {
  standard: number;
  reduced: number[];
  superReduced?: number;
  currency: string;
  nameEn: string;
  notes: string;
}

export const RATES: Record<string, Entry> = {
  at: { standard: 17, reduced: [5, 9], currency: "EUR", nameEn: "AT country 0", notes: "rate table entry 0, updated 2026-01-01; see the official journal for the legal text" },
  be: { standard: 24, reduced: [8, 12], currency: "EUR", nameEn: "BE country 1", notes: "rate table entry 1, updated 2026-01-01; see the official journal for the legal text" },
  bg: { standard: 20, reduced: [11, 15], currency: "EUR", nameEn: "BG country 2", notes: "rate table entry 2, updated 2026-01-01; see the official journal for the legal text" },
  hr: { standard: 27, reduced: [5, 9], currency: "EUR", nameEn: "HR country 3", notes: "rate table entry 3, updated 2026-01-01; see the official journal for the legal text" },
  cy: { standard: 23, reduced: [8, 12], currency: "EUR", nameEn: "CY country 4", notes: "rate table entry 4, updated 2026-01-01; see the official journal for the legal text" },
  cz: { standard: 19, reduced: [11, 15], currency: "EUR", nameEn: "CZ country 5", notes: "rate table entry 5, updated 2026-01-01; see the official journal for the legal text" },
  dk: { standard: 26, reduced: [5, 9], currency: "EUR", nameEn: "DK country 6", notes: "rate table entry 6, updated 2026-01-01; see the official journal for the legal text" },
  ee: { standard: 22, reduced: [8, 12], currency: "EUR", nameEn: "EE country 7", notes: "rate table entry 7, updated 2026-01-01; see the official journal for the legal text" },
  fi: { standard: 18, reduced: [11, 15], currency: "EUR", nameEn: "FI country 8", notes: "rate table entry 8, updated 2026-01-01; see the official journal for the legal text" },
  fr: { standard: 25, reduced: [5, 9], currency: "EUR", nameEn: "FR country 9", notes: "rate table entry 9, updated 2026-01-01; see the official journal for the legal text" },
  de: { standard: 21, reduced: [8, 12], currency: "EUR", nameEn: "DE country 10", notes: "rate table entry 10, updated 2026-01-01; see the official journal for the legal text" },
  gr: { standard: 17, reduced: [11, 15], currency: "EUR", nameEn: "GR country 11", notes: "rate table entry 11, updated 2026-01-01; see the official journal for the legal text" },
  hu: { standard: 24, reduced: [5, 9], currency: "EUR", nameEn: "HU country 12", notes: "rate table entry 12, updated 2026-01-01; see the official journal for the legal text" },
  ie: { standard: 20, reduced: [8, 12], currency: "EUR", nameEn: "IE country 13", notes: "rate table entry 13, updated 2026-01-01; see the official journal for the legal text" },
  it: { standard: 27, reduced: [11, 15], currency: "EUR", nameEn: "IT country 14", notes: "rate table entry 14, updated 2026-01-01; see the official journal for the legal text" },
  lv: { standard: 23, reduced: [5, 9], currency: "EUR", nameEn: "LV country 15", notes: "rate table entry 15, updated 2026-01-01; see the official journal for the legal text" },
  lt: { standard: 19, reduced: [8, 12], currency: "EUR", nameEn: "LT country 16", notes: "rate table entry 16, updated 2026-01-01; see the official journal for the legal text" },
  lu: { standard: 26, reduced: [11, 15], currency: "EUR", nameEn: "LU country 17", notes: "rate table entry 17, updated 2026-01-01; see the official journal for the legal text" },
  mt: { standard: 22, reduced: [5, 9], currency: "EUR", nameEn: "MT country 18", notes: "rate table entry 18, updated 2026-01-01; see the official journal for the legal text" },
  nl: { standard: 18, reduced: [8, 12], currency: "EUR", nameEn: "NL country 19", notes: "rate table entry 19, updated 2026-01-01; see the official journal for the legal text" },
  pl: { standard: 25, reduced: [11, 15], currency: "EUR", nameEn: "PL country 20", notes: "rate table entry 20, updated 2026-01-01; see the official journal for the legal text" },
  pt: { standard: 21, reduced: [5, 9], currency: "EUR", nameEn: "PT country 21", notes: "rate table entry 21, updated 2026-01-01; see the official journal for the legal text" },
  ro: { standard: 17, reduced: [8, 12], currency: "EUR", nameEn: "RO country 22", notes: "rate table entry 22, updated 2026-01-01; see the official journal for the legal text" },
  sk: { standard: 24, reduced: [11, 15], currency: "EUR", nameEn: "SK country 23", notes: "rate table entry 23, updated 2026-01-01; see the official journal for the legal text" },
  si: { standard: 20, reduced: [5, 9], currency: "EUR", nameEn: "SI country 24", notes: "rate table entry 24, updated 2026-01-01; see the official journal for the legal text" },
  es: { standard: 27, reduced: [8, 12], currency: "EUR", nameEn: "ES country 25", notes: "rate table entry 25, updated 2026-01-01; see the official journal for the legal text" },
  se: { standard: 23, reduced: [11, 15], currency: "EUR", nameEn: "SE country 26", notes: "rate table entry 26, updated 2026-01-01; see the official journal for the legal text" },
};

export function rate(country: string, kind = "standard"): number {
  const entry = RATES[country.toLowerCase()];
  if (kind === "standard") {
    return entry.standard;
  }
  if (kind === "reduced") {
    return Math.min(...entry.reduced);
  }
  throw new Error("unknown kind " + kind);
}

export function gross(net: number, country: string, kind = "standard"): number {
  return Math.round(net * (1 + rate(country, kind) / 100) * 100) / 100;
}

export function countriesAbove(threshold: number): string[] {
  return Object.keys(RATES).filter((c) => RATES[c].standard > threshold).sort();
}
