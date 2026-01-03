/**
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */
const config = {
  $schema: "https://json.schemastore.org/prettierrc",
  printWidth: 160,
  semi: true,
  singleQuote: true,
  overrides: [
    {
      files: ["**/*.css", "**/*.scss", "**/*.html"],
      options: { singleQuote: false },
    },
  ],
  trailingComma: "all",
  bracketSpacing: true,
  arrowParens: "always",
  proseWrap: "never",
  htmlWhitespaceSensitivity: "ignore",
  vueIndentScriptAndStyle: true,
  endOfLine: "crlf",
  plugins: [require("@ianvs/prettier-plugin-sort-imports")],
  importOrder: ["^@/", "^#", "^[./]"],
  importOrderTypeScriptVersion: "5.0.0",
  importOrderCaseSensitive: false,
};

module.exports = config;
