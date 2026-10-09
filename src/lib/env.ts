import { z } from 'zod';

/*
 * Configuration names live in `.env.example`; values are never committed.
 * The customer application fetches customer data in the browser only, never
 * during server rendering (F-01 technical design TD-3), so it needs no
 * server-only API URL: the one value is browser-safe.
 */

const absoluteUrl = z.url({ protocol: /^https?$/ });

const publicEnvSchema = z.object({ NEXT_PUBLIC_API_BASE_URL: absoluteUrl });

const EXPECTED: Record<string, string> = {
  NEXT_PUBLIC_API_BASE_URL: 'an http(s) URL, e.g. http://localhost:8000/api/v1',
};

/** Thrown when required configuration is missing or malformed. Lists every problem at once. */
export class EnvError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `Steward Menu is not configured correctly:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        'Set these in .env.local for development, or in the deployment environment. ' +
        'The variable names are listed in .env.example.',
    );
    this.name = 'EnvError';
  }
}

function describeProblem(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') return `${name} is not set.`;
  return `${name} must be ${EXPECTED[name] ?? 'valid'}.`;
}

function parseEnv<Schema extends z.ZodObject>(
  schema: Schema,
  values: Record<string, string | undefined>,
): z.output<Schema> {
  const parsed = schema.safeParse(values);
  if (parsed.success) return parsed.data;
  const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
  throw new EnvError(names.map((name) => describeProblem(name, values[name])));
}

/**
 * Browser-safe configuration. `NEXT_PUBLIC_*` values are inlined at build
 * time, so each must be referenced by its literal name here.
 */
export function getPublicEnv() {
  return parseEnv(publicEnvSchema, {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  });
}

/** Every configuration problem, for failing fast at build and server start. */
export function envProblems(env: Record<string, string | undefined> = process.env): string[] {
  const value = env.NEXT_PUBLIC_API_BASE_URL;
  return absoluteUrl.safeParse(value).success
    ? []
    : [describeProblem('NEXT_PUBLIC_API_BASE_URL', value)];
}

/** Throws an `EnvError` listing every configuration problem, if any. */
export function assertValidEnv(env: Record<string, string | undefined> = process.env) {
  const problems = envProblems(env);
  if (problems.length > 0) throw new EnvError(problems);
}
