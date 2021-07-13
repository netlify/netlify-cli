const { overrides } = require('@netlify/eslint-config-node')

module.exports = {
  extends: '@netlify/eslint-config-node',
  rules: {
    // Those rules from @netlify/eslint-config-node are currently disabled
    // TODO: remove, so those rules are enabled
    'class-methods-use-this': 0,
    complexity: 0,
    'max-depth': 0,
    'max-lines': 0,
    'max-lines-per-function': 0,
    'max-nested-callbacks': 0,
    'max-statements': 0,
    'no-param-reassign': 0,
    'no-process-exit': 0,
    'fp/no-class': 0,
    'fp/no-delete': 0,
    'fp/no-get-set': 0,
    'fp/no-let': 0,
    'fp/no-loops': 'error',
    'fp/no-mutating-assign': 0,
    'fp/no-mutating-methods': 0,
    'fp/no-mutation': 0,
    'fp/no-this': 0,
    'import/max-dependencies': 0,
    'node/no-sync': 0,
    'unicorn/prefer-spread': 0,
    'unicorn/consistent-destructuring': 0,
    // TODO: harmonize with filename snake_case in other Netlify Dev projects
    'unicorn/filename-case': [2, { case: 'kebabCase' }],
  },
  overrides: [
    ...overrides,
    // Documentation site's browser JavaScript
    {
      extends: '@netlify/eslint-config-node/react_config',
      files: ['site/src/**/*.js'],
      parserOptions: {
        sourceType: 'module',
        babelOptions: {
          presets: ['@babel/preset-react'],
          plugins: ['@babel/plugin-proposal-class-properties'],
        },
      },
      rules: {
        complexity: 0,
        'fp/no-class': 0,
        'fp/no-let': 0,
        'fp/no-this': 0,
        'fp/no-mutation': 0,
        'import/extensions': [2, 'always'],
        'node/no-unsupported-features/es-syntax': 0,
        'unicorn/consistent-destructuring': 0,
        'max-lines': 0,
        'array-callback-return': ['error', { checkForEach: true }],
      },
    },
    // Example functions
    {
      files: ['src/functions-templates/**/*.js'],
      rules: {
        'require-await': 0,
        'import/no-unresolved': 0,
        'node/no-missing-require': 0,
        'node/no-unsupported-features/es-syntax': 0,
      },
    },
  ],
}
