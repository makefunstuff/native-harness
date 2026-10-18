Updates to `src/vat.ts`. Change only what is listed; every other table entry must stay byte-for-byte
the same (the table is diffed against the official journal).

1. `fi`: the standard rate is now 26 (was 24), and its notes become
   `"rate table entry 8, updated 2026-09-01"`.
2. `ee`: the reduced rates are now `[9, 13]`.
3. `sk`: the standard rate is now 23.
4. `rate()` gets a new kind `"superReduced"`: return the entry's `superReduced` value when the
   entry has one, else throw `new Error("no super-reduced rate for <country>")`. Add
   `superReduced: 4.8` to the `fr` entry (keep the other keys of that entry as they are).

Add tests to `tests/vat.test.ts`. Run them with: node --test tests/*.test.ts
