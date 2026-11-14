# Product requirements: Express Checkout

**Status:** approved · **Owner:** Product · **Flag:** `express_checkout`

## Problem

Returning customers abandon the current checkout at the overview step. Analytics shows a drop between the information page and the overview page, concentrated on mobile.

## Goal

A returning customer can complete a purchase from the cart in a single submit. Target: lift checkout completion rate by 4 points in the treatment group.

## Scope

In scope: the checkout form, the order summary, totals, and the confirmation screen on web and mobile.

Out of scope: payment method selection, saved addresses, guest checkout, and anything in the catalog other than keeping existing behaviour intact.

## Requirements

1. The checkout form collects first name, last name and postal code on one page.
2. The order summary is visible on the same page and lists every item in the cart.
3. Item total, tax and total are displayed before the customer submits.
4. Tax is 8% of item total.
5. Validation errors appear inline per field and do not clear entered values.
6. Submitting a complete form shows a confirmation and clears the cart.
7. Customers in the control treatment see the existing three-step flow unchanged.

## Rollout

Behind `express_checkout`. 50/50 in test, 5% in production at launch. The experiment metric is checkout completion rate. If express wins, it goes to 100% and the flag is removed.

## Risks

Checkout is a payment-adjacent area, so every checkout test case is marked high risk and always reviewed by a person regardless of autonomy level.
