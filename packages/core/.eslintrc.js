module.exports = {
  env: {
    jest: true,
    node: true,
  },
  root: true,
  plugins: ["@typescript-eslint", "import", "prettier"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: "module",
    tsconfigRootDir: __dirname,
    project: "./tsconfig.dev.json",
  },
  extends: [
    "plugin:import/typescript",
    "prettier",
    "plugin:prettier/recommended",
  ],
  settings: {
    "import/parsers": {
      "@typescript-eslint/parser": [".ts", ".tsx"],
    },
    "import/resolver": {
      node: {},
      typescript: {
        project: "./tsconfig.dev.json",
        tsconfigRootDir: __dirname,
        alwaysTryTypes: true,
      },
    },
  },
  ignorePatterns: [
    "scripts/**",
    "register.js",
    "jest.js",
    "swc-config.js",
    ".eslintrc.js",
    "package.json",
  ],
  rules: {
    "prettier/prettier": ["error"],
    "@typescript-eslint/no-require-imports": ["error"],
    "import/no-extraneous-dependencies": [
      "error",
      {
        devDependencies: [
          "**/test/**",
          "**/build-tools/**",
          "**/projenrc/**",
          ".projenrc.ts",
          "projenrc/**/*.ts",
        ],
        optionalDependencies: false,
        peerDependencies: true,
      },
    ],
    "import/no-unresolved": ["error"],
    "import/order": [
      "warn",
      {
        groups: ["builtin", "external"],
        alphabetize: {
          order: "asc",
          caseInsensitive: true,
        },
      },
    ],
    "no-duplicate-imports": ["error"],
    "no-shadow": ["off"],
    "@typescript-eslint/no-shadow": "off",
    "key-spacing": ["error"],
    "no-multiple-empty-lines": ["error"],
    "@typescript-eslint/no-floating-promises": ["error"],
    "no-return-await": ["off"],
    "@typescript-eslint/return-await": ["error"],
    "no-trailing-spaces": ["error"],
    "dot-notation": ["error"],
    "no-bitwise": ["error"],
    "@typescript-eslint/member-ordering": "off",
    quotes: "off",
    "comma-dangle": "off",
    "quote-props": "off",
    "@typescript-eslint/indent": "off",
    "brace-style": "off",
    "@typescript-eslint/explicit-member-accessibility": "off",
    "no-debugger": "error",
  },
  overrides: [
    {
      files: ["*.ts", "*.mts", "*.cts", "*.tsx"],
      plugins: ["no-only-tests"],
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: ["./tsconfig.dev.json", "./test/tsconfig.json"],
      },
      rules: {
        "@typescript-eslint/explicit-member-accessibility": [
          "error",
          {
            accessibility: "explicit",
            overrides: {
              accessors: "explicit",
              constructors: "no-public",
              methods: "explicit",
              properties: "off",
              parameterProperties: "off",
            },
          },
        ],
        "no-only-tests/no-only-tests": [
          "error",
          {
            fix: true,
            block: ["test."],
          },
        ],
      },
    },
  ],
};