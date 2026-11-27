import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: [".local/**", "**/.next/**", "**/next-env.d.ts", "dist/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
];
