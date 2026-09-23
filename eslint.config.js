import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".codeartsdoer/**",
      "dist/**",
      "dist-chromium-compat/**",
      "dist-chromium-mv2/**",
      "dist-firefox/**",
      "dist-safari/**",
      "dist-userscript/**",
      "dist-web-demo/**",
      "node_modules/**",
      "public/**",
      ".vite/**",
      ".edge-*/**",
      "cloud-demo/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
