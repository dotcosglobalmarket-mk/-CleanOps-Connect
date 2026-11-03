// Lint rules for the whole repo. The API and tests are CommonJS for Node, the
// website scripts are browser modules, and the service worker is its own
// environment. `eslint:recommended` catches real mistakes (undefined names,
// unused variables, unreachable code) without style opinions.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'marketing/node_modules/**', 'marketing/dist/**', 'coverage/**'] },
  js.configs.recommended,
  {
    rules: {
      // An unused `catch (err)` is harmless and common here; Express error handlers
      // must keep their `next` argument; `_name` marks something unused on purpose;
      // dropping fields with `const { _owner, ...rest } = x` is intended.
      'no-unused-vars': ['error', { caughtErrors: 'none', argsIgnorePattern: '^(next|_)', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.jest } },
  },
  {
    files: ['marketing/js/**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['marketing/vite.config.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
  {
    files: ['marketing/public/sw.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } },
  },
];
