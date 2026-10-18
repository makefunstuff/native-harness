Updates to `vat.py`. Change only what is listed; every other table entry must stay byte-for-byte
the same (the table is diffed against the official journal).

1. `"fi"`: standard rate is now 26 (was 24), and its notes become
   `"rate table entry 8, updated 2026-09-01"`.
2. `"ee"`: reduced rates are now `[9, 13]`.
3. `"sk"`: standard rate is now 23.
4. `rate()` gets a new kind `"super_reduced"`: return the entry's `"super_reduced"` value when the
   entry has one, else raise `ValueError("no super-reduced rate for <country>")`. Add
   `"super_reduced": 4.8` to the `"fr"` entry (keep the other keys of that entry as they are).

Add tests to `tests/test_vat.py`. Run them with: python3 -m unittest discover -s tests
