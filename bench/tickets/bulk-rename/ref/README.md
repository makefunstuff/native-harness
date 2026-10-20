# shop

Use `orderTotal(items, { taxRate })` from `shop/money.ts` to total a list of `[price, qty]` pairs
with tax (`money(orderTotal([[10, 2], [1.5, 1]], { taxRate: 0.2 }))` is `"25.80"`).
`calcTotal(items, tax)` is deprecated.
