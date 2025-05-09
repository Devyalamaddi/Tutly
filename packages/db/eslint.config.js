import baseConfig from "@tutly/eslint-config/base";

/** @type {import('typescript-eslint').Config} */
export default [
  {
    ignores: ["dist/**", "prisma/seed/**"],
  },
  ...baseConfig,
];
