// ESLint flat config. Code-quality rules (complexity, size, unused code) are
// errors so `npm run check` and CI fail on them, not just warn.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'coverage/', 'reports/', '.dev/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      complexity: ['error', 10],
      'max-depth': ['error', 4],
      'max-params': ['error', 4],
      'max-nested-callbacks': ['error', 4],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-unused-private-class-members': 'error',
      'no-unreachable-loop': 'error',
      'no-useless-assignment': 'error',
      'no-shadow': 'error',
      'no-param-reassign': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Command-line tools print to the terminal on purpose.
    files: ['scripts/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  {
    // Scenario-style API tests are long by design; the per-function and
    // nesting limits still apply.
    files: ['test/**/*.js'],
    rules: { 'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }] },
  },
];
