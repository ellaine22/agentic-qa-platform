// Web regression: checkout. The payment-adjacent area, so every one of these
// is marked high risk in the case repository and always reviewed by a person
// regardless of autonomy level.

const addItemAndCheckout = () => {
  cy.signIn('standard_user', 'secret_sauce');
  cy.get('[data-test^=add-to-cart]').first().click();
  cy.get('.shopping_cart_link').click();
  cy.get('[data-test=checkout]').click();
};

describe('Checkout', () => {
  it('@case:WEB-CHK-001 Checkout completes with valid customer details', () => {
    addItemAndCheckout();
    cy.fillCheckoutForm({ firstName: 'Ada', lastName: 'Lovelace', postalCode: 'N2H 1A1' });
    cy.get('[data-test=continue]').click();
    cy.get('.summary_total_label').should('contain', 'Total');
    cy.get('[data-test=finish]').click();
    cy.get('.complete-header').should('be.visible');
    cy.get('.shopping_cart_badge').should('not.exist');
    cy.evidence('WEB-CHK-001');
  });

  it('@case:WEB-CHK-002 Checkout is refused when the last name is missing', () => {
    addItemAndCheckout();
    cy.fillCheckoutForm({ firstName: 'Ada', postalCode: 'N2H 1A1' });
    cy.get('[data-test=continue]').click();
    cy.get('[data-test=error]').should('contain.text', 'Last Name is required');
    cy.url().should('include', 'checkout-step-one');
    cy.evidence('WEB-CHK-002');
  });

  it('@case:WEB-CHK-003 Tax and total are calculated correctly', () => {
    addItemAndCheckout();
    cy.fillCheckoutForm({ firstName: 'Ada', lastName: 'Lovelace', postalCode: 'N2H 1A1' });
    cy.get('[data-test=continue]').click();
    cy.get('.summary_subtotal_label').invoke('text').then((subtotalText) => {
      const items = Number(subtotalText.replace(/[^0-9.]/g, ''));
      cy.get('.summary_tax_label').invoke('text').then((taxText) => {
        const tax = Number(taxText.replace(/[^0-9.]/g, ''));
        expect(tax, 'tax is 8% of item total').to.be.closeTo(items * 0.08, 0.01);
        cy.get('.summary_total_label').invoke('text').then((totalText) => {
          const total = Number(totalText.replace(/[^0-9.]/g, ''));
          expect(total, 'total is items plus tax').to.be.closeTo(items + tax, 0.01);
        });
      });
    });
    cy.evidence('WEB-CHK-003');
  });

  it('@case:WEB-CHK-005 Back Home after completion returns to the catalog', () => {
    addItemAndCheckout();
    cy.fillCheckoutForm({ firstName: 'Ada', lastName: 'Lovelace', postalCode: 'N2H 1A1' });
    cy.get('[data-test=continue]').click();
    cy.get('[data-test=finish]').click();
    cy.get('[data-test=back-to-products]').click();
    cy.url().should('include', '/inventory.html');
    cy.get('.shopping_cart_badge').should('not.exist');
  });
});
