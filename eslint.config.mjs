import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "db/migrations/**",
      "next-env.d.ts",
      "coverage/**",
      "tsconfig.tsbuildinfo",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
    },
  },
];

export default config;
