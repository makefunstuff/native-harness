"""Request handlers for the shop API. Each handler validates, loads, and serialises one resource."""
import json


class NotFound(Exception):
    pass


class Invalid(Exception):
    pass


class UserHandler:
    """Handles /users requests."""

    resource = "user"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("user: payload must be an object")
        if "id" not in payload:
            raise Invalid("user: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("user", ident))
            if item is not None:
                return item
        raise NotFound("user " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "user"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class OrderHandler:
    """Handles /orders requests."""

    resource = "order"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("order: payload must be an object")
        if "id" not in payload:
            raise Invalid("order: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("order", ident))
            if item is not None:
                return item
        raise NotFound("order " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "order"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class InvoiceHandler:
    """Handles /invoices requests."""

    resource = "invoice"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("invoice: payload must be an object")
        if "id" not in payload:
            raise Invalid("invoice: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("invoice", ident))
            if item is not None:
                return item
        raise NotFound("invoice " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "invoice"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class RefundHandler:
    """Handles /refunds requests."""

    resource = "refund"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("refund: payload must be an object")
        if "id" not in payload:
            raise Invalid("refund: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("refund", ident))
            if item is not None:
                return item
        raise NotFound("refund " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "refund"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class ShipmentHandler:
    """Handles /shipments requests."""

    resource = "shipment"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("shipment: payload must be an object")
        if "id" not in payload:
            raise Invalid("shipment: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("shipment", ident))
            if item is not None:
                return item
        raise NotFound("shipment " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "shipment"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class CouponHandler:
    """Handles /coupons requests."""

    resource = "coupon"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("coupon: payload must be an object")
        if "id" not in payload:
            raise Invalid("coupon: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("coupon", ident))
            if item is not None:
                return item
        raise NotFound("coupon " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "coupon"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class ReviewHandler:
    """Handles /reviews requests."""

    resource = "review"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("review: payload must be an object")
        if "id" not in payload:
            raise Invalid("review: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("review", ident))
            if item is not None:
                return item
        raise NotFound("review " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "review"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class AddressHandler:
    """Handles /addresss requests."""

    resource = "address"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("address: payload must be an object")
        if "id" not in payload:
            raise Invalid("address: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("address", ident))
            if item is not None:
                return item
        raise NotFound("address " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "address"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class PaymentHandler:
    """Handles /payments requests."""

    resource = "payment"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("payment: payload must be an object")
        if "id" not in payload:
            raise Invalid("payment: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("payment", ident))
            if item is not None:
                return item
        raise NotFound("payment " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "payment"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class SessionHandler:
    """Handles /sessions requests."""

    resource = "session"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("session: payload must be an object")
        if "id" not in payload:
            raise Invalid("session: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("session", ident))
            if item is not None:
                return item
        raise NotFound("session " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "session"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class CartHandler:
    """Handles /carts requests."""

    resource = "cart"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("cart: payload must be an object")
        if "id" not in payload:
            raise Invalid("cart: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("cart", ident))
            if item is not None:
                return item
        raise NotFound("cart " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "cart"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class WishlistHandler:
    """Handles /wishlists requests."""

    resource = "wishlist"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("wishlist: payload must be an object")
        if "id" not in payload:
            raise Invalid("wishlist: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("wishlist", ident))
            if item is not None:
                return item
        raise NotFound("wishlist " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "wishlist"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class TicketHandler:
    """Handles /tickets requests."""

    resource = "ticket"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("ticket: payload must be an object")
        if "id" not in payload:
            raise Invalid("ticket: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("ticket", ident))
            if item is not None:
                return item
        raise NotFound("ticket " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "ticket"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class SubscriptionHandler:
    """Handles /subscriptions requests."""

    resource = "subscription"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("subscription: payload must be an object")
        if "id" not in payload:
            raise Invalid("subscription: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("subscription", ident))
            if item is not None:
                return item
        raise NotFound("subscription " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "subscription"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class ReportHandler:
    """Handles /reports requests."""

    resource = "report"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("report: payload must be an object")
        if "id" not in payload:
            raise Invalid("report: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("report", ident))
            if item is not None:
                return item
        raise NotFound("report " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "report"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)

class WebhookHandler:
    """Handles /webhooks requests."""

    resource = "webhook"

    def __init__(self, store, retries=1):
        self.store = store
        self.retries = retries
        self.calls = 0

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise Invalid("webhook: payload must be an object")
        if "id" not in payload:
            raise Invalid("webhook: missing id")
        return True

    def load(self, ident):
        self.calls += 1
        for attempt in range(self.retries):
            item = self.store.get(("webhook", ident))
            if item is not None:
                return item
        raise NotFound("webhook " + str(ident))

    def serialise(self, item):
        data = dict(item)
        data["type"] = "webhook"
        return json.dumps(data, sort_keys=True)

    def handle(self, payload):
        self.validate(payload)
        item = self.load(payload["id"])
        return self.serialise(item)
