// Timing and dialog patterns, run against the second prototype site.
// These are the patterns the maintenance agent looks for when a spec turns
// flaky: implicit waits, fixed sleeps, and assertions racing a loader.

const SECONDARY = Cypress.env('secondaryUrl') || 'https://the-internet.herokuapp.com';

describe('Resilience patterns', () => {
  it('@case:WEB-RES-001 Content behind a loading indicator is asserted only once it appears', () => {
    cy.visit(`${SECONDARY}/dynamic_loading/2`);
    cy.get('#start button').click();
    // No cy.wait(ms). The assertion retries until the loader clears.
    cy.get('#loading', { timeout: 15000 }).should('not.be.visible');
    cy.get('#finish').should('be.visible').and('contain.text', 'Hello World');
    cy.evidence('WEB-RES-001');
  });

  it('@case:WEB-RES-002 A native confirm dialog is accepted and its result recorded', () => {
    cy.visit(`${SECONDARY}/javascript_alerts`);
    cy.on('window:confirm', () => true);
    cy.contains('button', 'Click for JS Confirm').click();
    cy.get('#result').should('contain.text', 'You clicked: Ok');
  });

  // Left here on purpose: this tag points at a case that no longer exists in
  // the repository. The coverage agent reports it as dead automation rather
  // than counting it toward coverage.
  it('@case:WEB-CAT-009 Legacy promo banner renders on the catalog', () => {
    cy.visit(`${SECONDARY}/`);
    cy.get('h1.heading').should('exist');
  });
});
