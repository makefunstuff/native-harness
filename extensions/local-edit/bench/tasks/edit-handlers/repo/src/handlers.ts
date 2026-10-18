// Request handlers for the shop API. Each handler validates, loads, and serialises one resource.

export class NotFound extends Error {}

export class Invalid extends Error {}

export type Store = Map<string, Record<string, unknown>>;

export const key = (kind: string, id: unknown) => kind + ":" + String(id);

export class UserHandler {
  // Handles /users requests.
  resource = "user";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("user: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("user: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("user", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("user " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "user";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class OrderHandler {
  // Handles /orders requests.
  resource = "order";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("order: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("order: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("order", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("order " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "order";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class InvoiceHandler {
  // Handles /invoices requests.
  resource = "invoice";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("invoice: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("invoice: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("invoice", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("invoice " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "invoice";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class RefundHandler {
  // Handles /refunds requests.
  resource = "refund";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("refund: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("refund: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("refund", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("refund " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "refund";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class ShipmentHandler {
  // Handles /shipments requests.
  resource = "shipment";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("shipment: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("shipment: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("shipment", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("shipment " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "shipment";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class CouponHandler {
  // Handles /coupons requests.
  resource = "coupon";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("coupon: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("coupon: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("coupon", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("coupon " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "coupon";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class ReviewHandler {
  // Handles /reviews requests.
  resource = "review";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("review: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("review: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("review", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("review " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "review";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class AddressHandler {
  // Handles /addresss requests.
  resource = "address";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("address: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("address: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("address", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("address " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "address";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class PaymentHandler {
  // Handles /payments requests.
  resource = "payment";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("payment: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("payment: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("payment", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("payment " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "payment";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class SessionHandler {
  // Handles /sessions requests.
  resource = "session";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("session: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("session: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("session", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("session " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "session";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class CartHandler {
  // Handles /carts requests.
  resource = "cart";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("cart: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("cart: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("cart", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("cart " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "cart";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class WishlistHandler {
  // Handles /wishlists requests.
  resource = "wishlist";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("wishlist: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("wishlist: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("wishlist", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("wishlist " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "wishlist";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class TicketHandler {
  // Handles /tickets requests.
  resource = "ticket";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("ticket: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("ticket: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("ticket", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("ticket " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "ticket";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class SubscriptionHandler {
  // Handles /subscriptions requests.
  resource = "subscription";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("subscription: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("subscription: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("subscription", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("subscription " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "subscription";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class ReportHandler {
  // Handles /reports requests.
  resource = "report";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("report: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("report: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("report", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("report " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "report";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}

export class WebhookHandler {
  // Handles /webhooks requests.
  resource = "webhook";
  store: Store;
  retries: number;
  calls = 0;

  constructor(store: Store, retries = 1) {
    this.store = store;
    this.retries = retries;
  }

  validate(payload: Record<string, unknown>): boolean {
    if (typeof payload !== "object" || payload === null) {
      throw new Invalid("webhook: payload must be an object");
    }
    if (!("id" in payload)) {
      throw new Invalid("webhook: missing id");
    }
    return true;
  }

  load(ident: unknown): Record<string, unknown> {
    this.calls += 1;
    for (let attempt = 0; attempt < this.retries; attempt++) {
      const item = this.store.get(key("webhook", ident));
      if (item !== undefined) {
        return item;
      }
    }
    throw new NotFound("webhook " + String(ident));
  }

  serialise(item: Record<string, unknown>): string {
    const data: Record<string, unknown> = { ...item };
    data.type = "webhook";
    return JSON.stringify(data, Object.keys(data).sort());
  }

  handle(payload: Record<string, unknown>): string {
    this.validate(payload);
    const item = this.load(payload.id);
    return this.serialise(item);
  }
}
