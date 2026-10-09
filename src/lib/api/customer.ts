import type { z } from 'zod';
import { getPublicEnv } from '@/lib/env';
import {
  buildUrl,
  getJson,
  sendRequest,
  type QueryParams,
  type RequestOptions,
  type WriteBody,
  type WriteMethod,
} from './request';

/*
 * Customer (F-01) API access from the browser. The customer session lives in
 * the HttpOnly `steward_customer_session` cookie, which the browser sends and
 * receives itself (`credentials: "include"`); JavaScript never sees it and
 * nothing is stored in localStorage or sessionStorage (F1-01).
 *
 * Customer writes carry **no** synchronizer CSRF token and never call
 * `GET /auth/csrf`, which serves restaurant users only: they are protected by
 * the backend's Origin/Referer check and the cookie's SameSite=Lax (F1-23,
 * auth contract §16). Restaurant writes keep using `clientSend`.
 *
 * Customer data is fetched in the browser only, never during server rendering,
 * so the cookie never has to reach the frontend host (F-01 technical design TD-3).
 */

export async function customerGet<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  params?: QueryParams,
  options: RequestOptions = {},
): Promise<z.output<Schema>> {
  const url = buildUrl(getPublicEnv().NEXT_PUBLIC_API_BASE_URL, path, params);
  return getJson(url, schema, { credentials: 'include', signal: options.signal });
}

export async function customerSend<Schema extends z.ZodType>(
  path: string,
  method: WriteMethod,
  schema: Schema,
  body?: WriteBody,
  options: RequestOptions = {},
): Promise<z.output<Schema>> {
  const url = buildUrl(getPublicEnv().NEXT_PUBLIC_API_BASE_URL, path);
  return sendRequest(url, method, schema, body, {
    credentials: 'include',
    signal: options.signal,
  });
}
