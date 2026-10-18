`slugify` (in `textkit/slugify.ts`) is broken for accented and punctuated titles:
`slugify("Crème Brûlée -- Recipe!")` must return `"creme-brulee-recipe"`. Rules: strip accents
(NFKD, drop combining marks), lower-case, every run of characters that are not a-z or 0-9
becomes a single `-`, no leading or trailing `-`. An empty result throws a RangeError.

Run the tests with `./run_tests.sh`.
