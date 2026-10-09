import { vi } from 'vitest';

/*
 * jsdom has no Next.js app router. Every test runs with this stand-in for
 * `next/navigation` (installed in `setup.ts`): `push` records client navigation
 * so tests can assert where a customer is sent (and that it is never a sign-in
 * page), and the search params can be set per test.
 */
export const routerPush = vi.fn<(href: string) => void>();
let searchParams = new URLSearchParams();
let pathname = '/';

export function setSearchParams(query: string) {
  searchParams = new URLSearchParams(query);
}

export function setPathname(path: string) {
  pathname = path;
}

export function resetNavigation() {
  routerPush.mockClear();
  searchParams = new URLSearchParams();
  pathname = '/';
}

export const nextNavigationMock = {
  useRouter: () => ({
    push: routerPush,
    replace: routerPush,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => searchParams,
  usePathname: () => pathname,
};
