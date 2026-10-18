import argparse
import csv
import sys


def load(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def main(argv=None):
    ap = argparse.ArgumentParser(description="Report stock levels")
    ap.add_argument("csv")
    ap.add_argument("--min-qty", type=int, default=0)
    a = ap.parse_args(argv)
    rows = [r for r in load(a.csv) if int(r["qty"]) >= a.min_qty]
    for r in sorted(rows, key=lambda r: r["name"]):
        print(f"{r['name']:<20} {int(r['qty']):>6} {float(r['price']):>10.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
