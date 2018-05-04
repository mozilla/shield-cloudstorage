module.exports = {
  env: {
    browser: true,
    es6: true,
    webextensions: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:mozilla/recommended",
  ],
  plugins: [
    "json",
    "mozilla",
  ],
  root: true,
  rules: {
    "eqeqeq": "off",
    "no-lonely-if": "off",
    "indent": ["error", 2],
    "no-console": "error",
    "no-warning-comments": ["off"],
    "prefer-const": "error",
    "quotes": ["error", "double"],
    "require-await": "error",
    "semi": ["error", "always"],
    "mozilla/no-import-into-var-and-global": 1
  }
};
