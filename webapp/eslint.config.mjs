export default [
  {
    files: ["**/*.js"],
    ignores: ["vendor/**", "service-worker.js"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2022,
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        EventSource: "readonly",
        FormData: "readonly",
        XMLHttpRequest: "readonly",
        Request: "readonly",
        Response: "readonly",
        fetch: "readonly",
        console: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        MouseEvent: "readonly",
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-undef": "error",
      "prefer-const": ["warn", { destructuring: "all" }],
    },
  },
];
