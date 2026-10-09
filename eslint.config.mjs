import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';

// Mocks, fixtures and MSW exist only for tests and local development.
// Production code must never import them.
const testOnlyImports = {
  patterns: [
    {
      regex: '^(@/test|.*/src/test)(/.*)?$',
      message: 'Test/mock infrastructure must not be imported by application code.',
    },
    {
      regex: '^msw(/.*)?$',
      message: 'MSW is test/development infrastructure only.',
    },
  ],
};

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  prettier,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/test/**', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', testOnlyImports],
    },
  },
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'next-env.d.ts',
    'playwright-report/**',
    'test-results/**',
    'coverage/**',
  ]),
]);
