import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvError, assertValidEnv, envProblems, getPublicEnv } from './env';

const VALID = { NEXT_PUBLIC_API_BASE_URL: 'http://api.test' };

describe('environment validation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts a complete configuration', () => {
    expect(envProblems(VALID)).toEqual([]);
    expect(() => assertValidEnv(VALID)).not.toThrow();
  });

  it('names a missing or malformed API base URL', () => {
    expect(envProblems({})).toEqual(['NEXT_PUBLIC_API_BASE_URL is not set.']);
    expect(envProblems({ NEXT_PUBLIC_API_BASE_URL: 'localhost:8000' })).toEqual([
      'NEXT_PUBLIC_API_BASE_URL must be an http(s) URL, e.g. http://localhost:8000/api/v1.',
    ]);
  });

  it('needs no server-only API URL: customer data is fetched in the browser only', () => {
    expect(envProblems({ ...VALID, API_BASE_URL: undefined })).toEqual([]);
  });

  it('throws an EnvError whose message points at .env.example', () => {
    expect(() => assertValidEnv({})).toThrow(EnvError);
    expect(() => assertValidEnv({})).toThrow(
      /NEXT_PUBLIC_API_BASE_URL is not set[\s\S]*\.env\.example/,
    );
  });

  it('the accessor reports the variable by name instead of a raw schema error', () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'not a url');
    expect(() => getPublicEnv()).toThrow(
      'NEXT_PUBLIC_API_BASE_URL must be an http(s) URL, e.g. http://localhost:8000/api/v1.',
    );
  });
});
