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
    // TODO: Remove these 3 rule overrides and use default "error" severity.
    "mozilla/no-define-cc-etc": "warn",
    "mozilla/no-import-into-var-and-global": "warn",
    "mozilla/use-cc-etc": "warn",

    "eqeqeq": "error",
    "indent": ["error", 2],
    "no-console": "warn",
    "no-var": "error",
    "no-warning-comments": ["warn", {terms: ["todo", "tbd", "fixme"], location: "anywhere"}],
    "prefer-const": "error",
    "prefer-template": "error",
    "quotes": ["error", "double"],
    "require-await": "error",
    "semi": ["error", "always"],
  }
};
