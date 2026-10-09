// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function applicationSources(dir: string = SRC): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== join(SRC, 'test')) files.push(...(await applicationSources(path)));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/** Source without comments: comments may state the rule ("never redirects to /login"). */
async function codeOf(file: string): Promise<string> {
  return (await readFile(file, 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Customers have no account and are never sent to a sign-in page (F-01 F1-17,
 * technical design §6). The customer application therefore contains no
 * restaurant-user auth: no sign-in route, redirect, session endpoint or CSRF
 * token fetch. This scans every application source file to prove it.
 */
describe('customer application has no restaurant-user auth', () => {
  it.each([
    ['a /login path', /['"`/]login\b/],
    ['the restaurant-user redirect', /redirect-?to-?login|redirectToLogin/i],
    ['a restaurant-user auth endpoint', /\/auth\//],
    ['the restaurant session cookie', /\bsteward_session\b/],
  ])('no application source references %s', async (_name, pattern) => {
    const offenders: string[] = [];
    for (const file of await applicationSources()) {
      if (pattern.test(await codeOf(file))) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it('would catch a sign-in redirect in code', () => {
    const code = "window.location.assign('/login?next=' + path);";
    expect(/['"`/]login\b/.test(code)).toBe(true);
  });
});
