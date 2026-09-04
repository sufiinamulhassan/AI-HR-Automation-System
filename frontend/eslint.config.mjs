import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import tsEslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      ".vite/",
      "next-env.d.ts",
      ".env.local",
      "src/app/",
      "public/mediapipe/",
      "public/models/"
    ]
  },
  js.configs.recommended,
  ...tsEslint.configs.recommended,
  {
    files: ["scripts/**/*.{js,mjs}", "*.config.{js,mjs}"],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsEslint.parser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_"
      }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "react/react-in-jsx-scope": "off"
    }
  }
]);

export default eslintConfig;
