// Web regression: authentication. Hand written.
// The @case:<ID> tag in each title is what the coverage agent reads.

describe('Authentication', () => {
  it('@case:WEB-AUTH-001 Customer signs in with valid credentials', () => {
    cy.signIn('standard_user', 'secret_sauce');
    cy.url().should('include', '/inventory.html');
    cy.get('.inventory_item').should('have.length', 6);
    cy.evidence('WEB-AUTH-001');
  });

  it('@case:WEB-AUTH-002 Sign-in is refused for a locked-out account', () => {
    cy.signIn('locked_out_user', 'secret_sauce');
    cy.get('[data-test=error]').should('contain.text', 'locked out');
    cy.url().should('not.include', '/inventory.html');
    cy.evidence('WEB-AUTH-002');
  });

  it('@case:WEB-AUTH-003 Sign-in is refused when the password is wrong', () => {
    cy.signIn('standard_user', 'wrong_password');
    cy.get('[data-test=error]').should('be.visible');
    cy.url().should('not.include', '/inventory.html');
  });

  it('@case:WEB-AUTH-004 Submitting an empty form shows a required-field error', () => {
    cy.visit('/');
    cy.get('[data-test=login-button]').click();
    cy.get('[data-test=error]').should('contain.text', 'Username is required');
  });

  it('@case:WEB-AUTH-005 Sign out returns the customer to the sign-in page', () => {
    cy.signIn('standard_user', 'secret_sauce');
    cy.get('#react-burger-menu-btn').click();
    cy.get('#logout_sidebar_link').click();
    cy.get('[data-test=login-button]').should('be.visible');
  });
});
