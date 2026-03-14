module.exports = {
  extends: 'expo',
  rules: {
    // Enforce consistent import order
    'import/order': 'off',
    // Allow unused vars prefixed with _
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
};
