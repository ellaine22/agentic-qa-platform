// Web regression: catalog and cart.
// WEB-CAT-004 and WEB-CART-004 are deliberately left unautomated so the
// coverage agent has a real gap to report.

describe('Catalog', () => {
  beforeEach(() => cy.signIn('standard_user', 'secret_sauce'));

  it('@case:WEB-CAT-001 Catalog lists every product with name, price and image', () => {
    cy.get('.inventory_item').should('have.length', 6).each(($item) => {
      cy.wrap($item).find('.inventory_item_name').should('not.be.empty');
      cy.wrap($item).find('.inventory_item_price').should('contain', '$');
      cy.wrap($item).find('img').should('have.attr', 'src').and('not.be.empty');
    });
    cy.evidence('WEB-CAT-001');
  });

  it('@case:WEB-CAT-002 Each product image is the product\'s own asset', () => {
    cy.get('.inventory_item_img img').then(($imgs) => {
      const sources = [...$imgs].map((img) => img.getAttribute('src'));
      expect(new Set(sources).size, 'every item has a distinct image').to.equal(sources.length);
      expect(sources.join(','), 'no placeholder asset').to.not.include('sl-404');
    });
    cy.evidence('WEB-CAT-002');
  });

  // Sorting cases live in the per-treatment specs under cypress/e2e/web/,
  // because they branch on the sorted_catalog flag.

  it('@case:WEB-CAT-005 Opening a product shows its detail page', () => {
    cy.get('.inventory_item_name').first().invoke('text').then((name) => {
      cy.get('.inventory_item_name').first().click();
      cy.get('[data-test=inventory-item-name]').should('have.text', name);
      cy.get('[data-test=inventory-item-price]').should('contain', '$');
    });
  });
});

describe('Cart', () => {
  beforeEach(() => cy.signIn('standard_user', 'secret_sauce'));

  it('@case:WEB-CART-001 Adding a product updates the cart badge', () => {
    cy.get('[data-test^=add-to-cart]').first().click();
    cy.get('.shopping_cart_badge').should('have.text', '1');
    cy.evidence('WEB-CART-001');
  });

  it('@case:WEB-CART-002 Removing a product from the catalog clears the badge', () => {
    cy.get('[data-test^=add-to-cart]').first().click();
    cy.get('[data-test^=remove]').first().click();
    cy.get('.shopping_cart_badge').should('not.exist');
  });

  it('@case:WEB-CART-003 The cart page lists the products that were added', () => {
    cy.get('[data-test^=add-to-cart]').eq(0).click();
    cy.get('[data-test^=add-to-cart]').eq(1).click();
    cy.get('.shopping_cart_link').click();
    cy.get('.cart_item').should('have.length', 2);
    cy.get('.cart_item .inventory_item_price').each(($p) => expect($p.text()).to.contain('$'));
  });
});
