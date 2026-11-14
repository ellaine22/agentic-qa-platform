// Flag: sorted_catalog · treatment: off
// The losing treatment. Once the experiment concluded, this spec is dead
// weight: it asserts behaviour no customer will ever see again. The automation
// agent deletes it on promotion, which is how automation stops accumulating.

describe('Sorted catalog — off', () => {
  beforeEach(() => {
    cy.setTreatment('sorted_catalog', 'off');
    cy.signIn();
  });

  it('@case:WEB-CAT-004 Sorting by name descending reorders the catalog', () => {
    cy.get('[data-test=product-sort-container]').select('za');
    cy.get('.inventory_item_name').then(($n) => {
      const names = [...$n].map((el) => el.innerText);
      expect(names).to.deep.equal([...names].sort().reverse());
    });
  });
});
