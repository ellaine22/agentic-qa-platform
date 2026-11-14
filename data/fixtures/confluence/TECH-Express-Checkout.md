# Tech investigation: Express Checkout

**Status:** reviewed · **Owner:** Engineering · **Flag:** `express_checkout`

## Approach

The express treatment renders a new single-page checkout component. The control treatment keeps the existing route chain untouched. The flag is read once per session on entry to the cart, so a customer does not switch treatments mid-purchase.

## Routes and screens touched

| Route | Change |
|---|---|
| `/cart.html` | Checkout button routes by treatment |
| `/checkout-step-one.html` | Control only |
| `/checkout-step-two.html` | Control only |
| `/checkout-express.html` | New, express only |
| `/checkout-complete.html` | Shared confirmation |
| `/inventory.html` | Unchanged, but regression risk from the shared header and cart badge |

Mobile screens: `CartScreen`, `CheckoutScreen`, `CheckoutCompleteScreen`.

## Known risks

- The shared header and cart badge component is modified, so catalog and cart regression cases are in the blast radius even though the catalog is out of scope.
- Product image loading uses the same asset resolver that checkout thumbnails use. A regression here would show as wrong or placeholder images on the catalog.
- The last-name field in the express form binds to a new controlled input. Watch for dropped keystrokes.
- Totals are computed client side in the express treatment and server side in control. The two must agree.

## Test data

Use the standard test identities. In test environments the flag platform allows a per-session treatment override, so both treatments can be exercised in one run.
