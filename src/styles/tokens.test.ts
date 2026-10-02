// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const appCssPath = resolve(dirname(fileURLToPath(import.meta.url)), '../app/globals.css');

async function buildCss(candidates: string[]): Promise<string> {
  const compiler = await compile(await readFile(appCssPath, 'utf8'), {
    base: dirname(appCssPath),
    loadStylesheet: async (id, base) => {
      const path =
        id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : resolve(base, id);
      return { path, base: dirname(path), content: await readFile(path, 'utf8') };
    },
  });
  return compiler.build(candidates);
}

describe('design tokens', () => {
  it('removes the Tailwind default palette', async () => {
    const css = await buildCss(['bg-blue-500', 'text-gray-700', 'bg-green-500', 'bg-red-600']);
    expect(css).not.toMatch(/\.bg-blue-500|\.text-gray-700|\.bg-green-500|\.bg-red-600/);
  });

  it('exposes Steward semantic tokens as utilities', async () => {
    const css = await buildCss([
      'bg-brand',
      'text-text-muted',
      'text-danger',
      'bg-confirmation-subtle',
    ]);
    expect(css).toContain('.bg-brand');
    expect(css).toContain('var(--color-brand)');
    expect(css).toContain('.text-danger');
    expect(css).toContain('.bg-confirmation-subtle');
  });
});
