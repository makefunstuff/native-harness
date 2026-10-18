# shop

Use `orderTotal(items, { taxRate })` from `shop/money.ts` to total a list of `[price, qty]` pairs with
tax (e.g. `orderTotal([[2.5, 4]], { taxRate: 0.2 })` is 12). `calcTotal(items, tax)` is a deprecated alias.
