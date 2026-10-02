import type { NextConfig } from 'next';
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from 'next/constants';
import { assertValidEnv } from './src/lib/env';

const nextConfig: NextConfig = {
  poweredByHeader: false,
};

/**
 * Fails fast with a readable list of configuration problems. At build time
 * the `NEXT_PUBLIC_*` values are inlined into the browser bundle, so a
 * missing one would otherwise surface only as a runtime failure.
 */
export default function config(phase: string): NextConfig {
  if (
    phase === PHASE_PRODUCTION_BUILD ||
    phase === PHASE_PRODUCTION_SERVER ||
    phase === PHASE_DEVELOPMENT_SERVER
  ) {
    assertValidEnv();
  }
  return nextConfig;
}
