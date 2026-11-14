// Flag: sorted_catalog · treatment: on
// Written during the experiment, while both treatments were live. When the
// experiment concluded with "on" as the winner, the automation agent kept this
// spec and stripped its treatment override.

describe('Sorted catalog — on', () => {
  beforeEach(() => {
    cy.setTreatment('sorted_catalog', 'on');
    cy.signIn();
  });

  it('@case:WEB-CAT-003 Sorting by price ascending reorders the catalog', () => {
    cy.get('[data-test=product-sort-container]').select('lohi');
    cy.get('.inventory_item_price').then(($p) => {
      const prices = [...$p].map((el) => Number(el.innerText.replace('$', '')));
      expect(prices).to.deep.equal([...prices].sort((a, b) => a - b));
    });
    cy.evidence('WEB-CAT-003');
  });
});
