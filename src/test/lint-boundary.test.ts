// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * The first `lintText` loads the TypeScript parser and the whole config, which
 * can exceed Vitest's default 5 s while the rest of the suite runs in parallel.
 */
const ESLINT_TIMEOUT = { timeout: 30_000 };

/** Proves the ESLint rule that keeps mocks out of application code. */
describe('test/mock import boundary', ESLINT_TIMEOUT, () => {
  const eslint = new ESLint();

  async function restrictedImportErrors(code: string, filePath: string) {
    const [result] = await eslint.lintText(code, { filePath });
    return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-imports');
  }

  it.each([
    ["import { MOCK_QR } from '@/test/factories/customer';", 'src/app/t/[qrCode]/page.tsx'],
    ["import { http } from 'msw';", 'src/features/customer-menu/api.ts'],
    ["import { mswServer } from '@/test/msw/node';", 'src/lib/api/x.ts'],
  ])('rejects %s in %s', async (code, filePath) => {
    expect(await restrictedImportErrors(code, filePath)).toHaveLength(1);
  });

  it('allows the same imports in tests and in test infrastructure', async () => {
    const code =
      "import { http } from 'msw';\nimport { MOCK_QR } from '@/test/factories/customer';";
    expect(await restrictedImportErrors(code, 'src/lib/api/request.test.ts')).toHaveLength(0);
    expect(await restrictedImportErrors(code, 'src/test/msw/handlers/customer.ts')).toHaveLength(0);
  });
});
