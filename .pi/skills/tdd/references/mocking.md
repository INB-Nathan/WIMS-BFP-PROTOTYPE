# When to Mock

Mock at **system boundaries** only:

- External APIs (payment, email, etc.)
- Databases (sometimes - prefer test DB)
- Time/randomness
- File system (sometimes)

Don't mock:

- Your own classes/modules
- Internal collaborators
- Anything you control

## WIMS-specific boundaries

In WIMS-BFP, system boundaries for mocking include:

- OpenBao transit encryption (mock the provider, not the encryption logic)
- External AFOR/incident data sources
- Keycloak admin API calls
- Celery broker (use `celery.contrib.testing` or in-memory broker for task tests)
- PostgreSQL/PostGIS (prefer a test database over mocking; spatial predicates must exercise real PostGIS)

## Designing for Mockability

At system boundaries, design interfaces that are easy to mock:

**1. Use dependency injection**

Pass external dependencies in rather than creating them internally:

```python
# Easy to mock
def process_payment(order, payment_client):
    return payment_client.charge(order.total)

# Hard to mock
def process_payment(order):
    client = StripeClient(os.environ["STRIPE_KEY"])
    return client.charge(order.total)
```

**2. Prefer SDK-style interfaces over generic fetchers**

Create specific functions for each external operation instead of one generic function with conditional logic:

```python
# GOOD: Each function is independently mockable
class ApiClient:
    def get_user(self, id): ...
    def get_orders(self, user_id): ...
    def create_order(self, data): ...

# BAD: Mocking requires conditional logic inside the mock
class ApiClient:
    def fetch(self, endpoint, options): ...
```

The SDK approach means:
- Each mock returns one specific shape
- No conditional logic in test setup
- Easier to see which endpoints a test exercises
- Type safety per endpoint (Pydantic models on responses)
