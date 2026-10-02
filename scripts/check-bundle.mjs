// Fails if test/mock infrastructure reached the production build
// (F-07 design §14.0). Run after `pnpm build`.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const BUILD_DIRS = ['.next/static', '.next/server'];
const FORBIDDEN_MARKERS = [
  '__steward_test_fixture__',
  '@mswjs/interceptors',
  'setupServer',
  'mock-api',
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(js|mjs|cjs|json|html|rsc)$/.test(entry.name)) yield path;
  }
}

const findings = [];
for (const dir of BUILD_DIRS) {
  for await (const file of walk(dir)) {
    const content = await readFile(file, 'utf8');
    for (const marker of FORBIDDEN_MARKERS) {
      if (content.includes(marker)) findings.push(`${file}: contains "${marker}"`);
    }
  }
}

if (findings.length > 0) {
  console.error('Test/mock code found in the production build:\n' + findings.join('\n'));
  process.exit(1);
}
console.log('check:bundle — no test/mock code in the production build.');
