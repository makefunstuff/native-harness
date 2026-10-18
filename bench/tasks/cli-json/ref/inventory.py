import argparse, csv, json, sys


def load(path):
    rows = []
    with open(path, newline="") as f:
        for i, r in enumerate(csv.DictReader(f), 1):
            try:
                rows.append({"name": r["name"], "qty": int(r["qty"]), "price": float(r["price"])})
            except (ValueError, TypeError) as e:
                print(f"skipping row {i}: {e}", file=sys.stderr)
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description="Report stock levels")
    ap.add_argument("csv")
    ap.add_argument("--min-qty", type=int, default=0)
    ap.add_argument("--format", choices=["table", "json"], default="table")
    a = ap.parse_args(argv)
    rows = sorted((r for r in load(a.csv) if r["qty"] >= a.min_qty), key=lambda r: r["name"])
    if a.format == "json":
        print(json.dumps(rows))
    else:
        for r in rows:
            print(f"{r['name']:<20} {r['qty']:>6} {r['price']:>10.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
