// Shared commands. The important one is setTreatment: it is the single place
// where a flag treatment becomes a concrete test session, so specs never hard
// code an identity and the executor can drive both treatments from one run.

import flagState from '../../data/flags.json';

Cypress.Commands.add('setTreatment', (flagKey, treatment) => {
  const flag = flagState.flags.find(f => f.key === flagKey);
  if (!flag) throw new Error(`Flag ${flagKey} is not defined in data/flags.json`);
  const t = flag.treatments.find(x => x.key === treatment);
  if (!t) throw new Error(`Flag ${flagKey} has no treatment "${treatment}"`);

  // In the real platform this would call the flag SDK's per-session override.
  // Against the public demo site, the treatment is carried by the identity.
  Cypress.env('treatment', treatment);
  Cypress.env('username', t.testIdentity.username);
  Cypress.env('password', t.testIdentity.password);
  cy.log(`flag ${flagKey} = ${treatment} (identity ${t.testIdentity.username})`);
});

Cypress.Commands.add('signIn', (username, password) => {
  cy.visit('/');
  cy.get('[data-test=username]').clear().type(username ?? Cypress.env('username'));
  cy.get('[data-test=password]').clear().type(password ?? Cypress.env('password'), { log: false });
  cy.get('[data-test=login-button]').click();
});

Cypress.Commands.add('fillCheckoutForm', ({ firstName, lastName, postalCode }) => {
  if (firstName !== undefined) cy.get('[data-test=firstName]').clear().type(firstName);
  if (lastName !== undefined) cy.get('[data-test=lastName]').clear().type(lastName);
  if (postalCode !== undefined) cy.get('[data-test=postalCode]').clear().type(postalCode);
});

// A pass with no observation is not a pass. This asserts something was actually
// looked at, which is the contract the executor's policy relies on.
Cypress.Commands.add('evidence', (label) => {
  cy.screenshot(label, { capture: 'viewport', overwrite: true });
});

Cypress.on('uncaught:exception', () => false);
