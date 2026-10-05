/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "@remix-run/eslint-config/jest-testing-library",
    "prettier",
  ],
  globals: {
    shopify: "readonly"
  },
  settings: {
    // Tests run on node:test, so Jest is deliberately not installed. The
    // inherited jest-testing-library config still loads eslint-plugin-jest,
    // which throws while trying to detect a Jest version; pinning one here
    // keeps it quiet without pulling in a test framework we do not use.
    jest: { version: 29 },
  },
};
