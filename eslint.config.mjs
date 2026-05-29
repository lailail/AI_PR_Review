import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

/**
 * ESLint 9 使用 flat config。
 * 这里复用 Next.js 官方规则，并忽略构建产物，保证本地检查只覆盖项目源码。
 */
export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "node_modules/**"]),
]);
