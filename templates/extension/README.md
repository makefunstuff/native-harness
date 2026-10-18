# Extension template

Copy this folder to `extensions/<name>/` to start a new pi-extras extension:

- `index.ts`: the extension (pi loads `extensions/*/index.ts` through the package manifest);
- `index.test.ts`: unit tests with `node:test` and the fake pi API from `test/lib/fake-pi.ts`;
- `template.smoke.mjs`: a headless `pi -p` run against a mock model (see `test/lib/harness.mjs`).
  Name yours `<name>.smoke.mjs`; drop the `args` line, a real extension is loaded from the manifest.

Then add a line for it to the extension list in the top-level README.
