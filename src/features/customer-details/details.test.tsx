import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { useCookielessMockDevice } from '@/test/msw/handlers/customer';
import { mswServer } from '@/test/msw/node';
import { errorResponse } from '@/test/msw/respond';
import { routerPush } from '@/test/next-navigation';
import { recordRequests, renderCustomerPage } from '@/test/render-customer';
import { detailsProblemFor } from './details-problem';
import { DetailsSchema } from './schemas';

/*
 * Customer details (F-01 S3, technical design §7): Name + Indian mobile number,
 * validated and normalized by the backend (the contract-mirroring MSW handlers
 * here). No OTP; nothing kept in the browser.
 */

beforeEach(() => {
  useCookielessMockDevice();
});

afterEach(() => {
  vi.useRealTimers();
  mswServer.events.removeAllListeners();
});

async function formLoaded() {
  await screen.findByRole('heading', { name: 'Your details' });
  return {
    name: await screen.findByRole('textbox', { name: 'Name' }),
    mobile: screen.getByRole('textbox', { name: 'Mobile number' }),
    submit: screen.getByRole('button', { name: 'Continue to review' }),
  };
}

describe('the details page', () => {
  it('explains the Indian mobile format and that no code is needed', async () => {
    renderCustomerPage('details');
    const { mobile } = await formLoaded();
    expect(mobile).toHaveAccessibleDescription(
      'A 10-digit Indian mobile number, for example 98765 43210. No verification code is needed.',
    );
    expect(screen.queryByText(/OTP|one-time/i)).toBeNull();
  });

  it('sends the details as typed, then continues to review', async () => {
    const requests = recordRequests();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderCustomerPage('details');
    const { name, mobile, submit } = await formLoaded();

    await userEvent.type(name, '  Asha Rao ');
    await userEvent.type(mobile, '+91 98765-43210');
    await userEvent.click(submit);

    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith('/t/mockQrTable01Active000/checkout'),
    );
    const put = fetchSpy.mock.calls.find(
      ([url, init]) => String(url).endsWith('/customer/details') && init?.method === 'PUT',
    );
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      name: '  Asha Rao ',
      mobile: '+91 98765-43210',
    });
    expect(put?.[1]?.credentials).toBe('include');
    const write = requests.find((r) => r.method === 'PUT');
    expect(write?.headers.get('X-CSRF-Token')).toBeNull();
    fetchSpy.mockRestore();
  });

  it('shows what was saved after a reload', async () => {
    const first = renderCustomerPage('details');
    const form = await formLoaded();
    await userEvent.type(form.name, 'Asha Rao');
    await userEvent.type(form.mobile, '09876543210');
    await userEvent.click(form.submit);
    await waitFor(() => expect(routerPush).toHaveBeenCalled());
    first.unmount();

    renderCustomerPage('details');
    const again = await formLoaded();
    expect(again.name).toHaveValue('Asha Rao');
    expect(again.mobile).toHaveValue('9876543210'); // the normalized national number
  });

  it('shows each field error from the server next to its field', async () => {
    renderCustomerPage('details');
    const { name, mobile, submit } = await formLoaded();
    await userEvent.type(name, '   ');
    await userEvent.type(mobile, '5876543210');
    await userEvent.click(submit);

    expect(await screen.findByText('Enter your name.')).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Enter your name.');
    expect(mobile).toHaveAttribute('aria-invalid', 'true');
    expect(mobile).toHaveAccessibleDescription(
      expect.stringContaining('Enter a 10-digit Indian mobile number, for example 98765 43210.'),
    );
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('disables the button while saving', async () => {
    let release: () => void = () => {};
    mswServer.use(
      http.put(
        '*/customer/details',
        () =>
          new Promise<Response>((resolve) => {
            release = () =>
              resolve(HttpResponse.json({ data: { name: 'Asha', mobile: '+919876543210' } }));
          }),
      ),
    );
    renderCustomerPage('details');
    const { name, mobile, submit } = await formLoaded();
    await userEvent.type(name, 'Asha');
    await userEvent.type(mobile, '9876543210');
    await userEvent.click(submit);
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    release();
    await waitFor(() => expect(routerPush).toHaveBeenCalled());
  });

  it('asks the customer to wait when rate limited, and shows other errors with a reference', async () => {
    let attempt = 0;
    mswServer.use(
      http.put('*/customer/details', () => {
        attempt += 1;
        return attempt === 1
          ? HttpResponse.json(
              { error: { code: 'rate_limited', message: 'm', request_id: 'r' } },
              { status: 429, headers: { 'Retry-After': '30' } },
            )
          : errorResponse(500, 'internal_error', 'Internal error', 'req-details-500');
      }),
    );
    renderCustomerPage('details');
    const { name, mobile, submit } = await formLoaded();
    await userEvent.type(name, 'Asha');
    await userEvent.type(mobile, '9876543210');
    await userEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please wait 30 seconds and try again.',
    );
    await userEvent.click(submit);
    expect(await screen.findByText('Reference: req-details-500')).toBeInTheDocument();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('keeps nothing in browser storage and never sends anyone to a sign-in page', async () => {
    renderCustomerPage('details');
    const { name, mobile, submit } = await formLoaded();
    await userEvent.type(name, 'Asha');
    await userEvent.type(mobile, '9876543210');
    await userEvent.click(submit);
    await waitFor(() => expect(routerPush).toHaveBeenCalled());
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(routerPush.mock.calls.flat().some((href) => href.includes('login'))).toBe(false);
  });
});

describe('details contract', () => {
  it('parses the customer’s own details, or nulls when not given', () => {
    expect(DetailsSchema.parse({ data: { name: 'Asha', mobile: '+919876543210' } })).toEqual({
      name: 'Asha',
      mobile: '+919876543210',
    });
    expect(DetailsSchema.parse({ data: { name: null, mobile: null } })).toEqual({
      name: null,
      mobile: null,
    });
    expect(DetailsSchema.safeParse({ data: { name: 'A', mobile: '9876543210' } }).success).toBe(
      false,
    );
  });

  it('maps every documented field code', () => {
    const error = (fields: Record<string, string>) =>
      new ApiError({
        status: 422,
        kind: 'validation',
        code: 'validation_failed',
        details: {
          fields: Object.fromEntries(
            Object.entries(fields).map(([field, code]) => [field, [{ code, message: 'm' }]]),
          ),
        },
      });
    expect(detailsProblemFor(error({ name: 'name_too_long', mobile: 'mobile_invalid' }))).toEqual({
      kind: 'fields',
      fields: {
        name: 'Use at most 80 characters.',
        mobile: 'Enter a 10-digit Indian mobile number, for example 98765 43210.',
      },
    });
    expect(detailsProblemFor(error({ name: 'name_invalid' }))).toEqual({
      kind: 'fields',
      fields: { name: 'Remove special characters from your name.' },
    });
  });
});
