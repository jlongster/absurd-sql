module.exports = {
  env: {
    browser: true,
    node: true,
    es2021: true,
    jest: true,
    worker: true,
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  rules: {
    'no-unused-vars': 'off',
    'no-inner-declarations': 'off',
  },
};
