import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'https://www.saucedemo.com',
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: 'cypress/support/e2e.js',
    screenshotOnRunFailure: true,
    video: false,
    defaultCommandTimeout: 8000,
    retries: { runMode: 1, openMode: 0 },
    env: {
      // The executor overrides these per treatment via --env.
      treatment: 'control',
      username: 'standard_user',
      password: 'secret_sauce',
      secondaryUrl: 'https://the-internet.herokuapp.com'
    }
  }
});
