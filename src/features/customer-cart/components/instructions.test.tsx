import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCart, buildCartLine, MOCK_DISHES, MOCK_QR } from '@/test/factories/customer';
import { useCookielessMockDevice } from '@/test/msw/handlers/customer';
import { mswServer } from '@/test/msw/node';
import { setSearchParams } from '@/test/next-navigation';
import { renderCustomerPage } from '@/test/render-customer';

/*
 * Special instructions on cart lines (F-01 S3, technical design §5, §8): plain
 * text, no price effect; a line is (dish, instructions), so one dish can have
 * several lines, and matching instructions merge lines on the server.
 */

beforeEach(() => {
  useCookielessMockDevice();
});

afterEach(() => {
  mswServer.events.removeAllListeners();
});

/** Enters the session and fills its server cart through the real mock handlers. */
async function cartWith(...adds: { item: string; instructions?: string }[]) {
  await fetch('http://api.test/customer/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qr_code: MOCK_QR.table1 }),
  });
  for (const add of adds) {
    await fetch('http://api.test/customer/cart/lines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        menu_item_id: add.item,
        quantity: 1,
        ...(add.instructions ? { special_instructions: add.instructions } : {}),
      }),
    });
  }
}

async function openCart() {
  renderCustomerPage('cart');
  await screen.findByRole('heading', { name: 'Your cart' });
}

describe('special instructions on the cart page', () => {
  it('adds, shows, edits and clears a line’s note without changing its price', async () => {
    await cartWith({ item: MOCK_DISHES.dal.id });
    await openCart();
    const dal = await screen.findByRole('listitem', { name: 'Dal Makhani' });

    await userEvent.click(
      within(dal).getByRole('button', { name: 'Add instructions for Dal Makhani' }),
    );
    const note = within(dal).getByRole('textbox', { name: 'Instructions for Dal Makhani' });
    expect(note).toHaveAttribute('maxLength', '200');
    expect(note).toHaveAccessibleDescription(/doesn't change the price/);
    await userEvent.type(note, '  no onion ');
    await userEvent.click(within(dal).getByRole('button', { name: 'Save note' }));

    const noted = await screen.findByRole('listitem', { name: 'Dal Makhani (no onion)' });
    expect(noted).toHaveTextContent('Note: no onion');
    expect(noted).toHaveTextContent('₹220.00'); // no price effect

    await userEvent.click(
      within(noted).getByRole('button', { name: 'Edit instructions for Dal Makhani (no onion)' }),
    );
    await userEvent.clear(
      within(noted).getByRole('textbox', { name: 'Instructions for Dal Makhani (no onion)' }),
    );
    await userEvent.click(within(noted).getByRole('button', { name: 'Save note' }));
    const cleared = await screen.findByRole('listitem', { name: 'Dal Makhani' });
    expect(cleared).not.toHaveTextContent('Note:');
  });

  it('renders instructions as plain text, never as markup', async () => {
    const markup = '<img src=x onerror=alert(1)> <b>extra</b>';
    mswServer.use(
      http.get('*/customer/cart', () =>
        HttpResponse.json(
          buildCart([buildCartLine(MOCK_DISHES.dal, 1, { specialInstructions: markup })]),
        ),
      ),
    );
    await openCart();
    const line = await screen.findByRole('listitem', { name: `Dal Makhani (${markup})` });
    expect(line).toHaveTextContent(`Note: ${markup}`);
    expect(line.querySelector('img, b')).toBeNull();
  });

  it('keeps separate lines for one dish and tells them apart', async () => {
    await cartWith(
      { item: MOCK_DISHES.dal.id },
      { item: MOCK_DISHES.dal.id, instructions: 'extra spicy' },
    );
    await openCart();
    const spicy = await screen.findByRole('listitem', { name: 'Dal Makhani (extra spicy)' });
    const plain = screen.getByRole('listitem', { name: 'Dal Makhani' });
    expect(
      within(spicy).getByRole('group', { name: 'Dal Makhani (extra spicy) quantity' }),
    ).toHaveTextContent('1');
    expect(within(plain).getByRole('button', { name: 'Remove Dal Makhani' })).toBeEnabled();
    expect(
      within(spicy).getByRole('button', { name: 'Remove Dal Makhani (extra spicy)' }),
    ).toBeEnabled();
  });

  it('merges two lines when their instructions become the same', async () => {
    await cartWith(
      { item: MOCK_DISHES.dal.id },
      { item: MOCK_DISHES.dal.id, instructions: 'no onion' },
    );
    await openCart();
    const plain = await screen.findByRole('listitem', { name: 'Dal Makhani' });
    await userEvent.click(
      within(plain).getByRole('button', { name: 'Add instructions for Dal Makhani' }),
    );
    await userEvent.type(
      within(plain).getByRole('textbox', { name: 'Instructions for Dal Makhani' }),
      'no onion',
    );
    await userEvent.click(within(plain).getByRole('button', { name: 'Save note' }));

    // The server merged the two lines into one.
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Dal Makhani' })).toBeNull());
    const merged = screen.getByRole('listitem', { name: 'Dal Makhani (no onion)' });
    expect(
      within(merged).getByRole('group', { name: 'Dal Makhani (no onion) quantity' }),
    ).toHaveTextContent('2');
  });

  it('explains when a note is too long', async () => {
    mswServer.use(
      http.patch('*/customer/cart/lines/:lineId', () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_failed',
              message: 'm',
              details: {
                fields: {
                  special_instructions: [{ code: 'special_instructions_too_long', message: 'm' }],
                },
              },
            },
          },
          { status: 422 },
        ),
      ),
    );
    await cartWith({ item: MOCK_DISHES.dal.id });
    await openCart();
    const dal = await screen.findByRole('listitem', { name: 'Dal Makhani' });
    await userEvent.click(
      within(dal).getByRole('button', { name: 'Add instructions for Dal Makhani' }),
    );
    await userEvent.type(within(dal).getByRole('textbox'), 'x');
    await userEvent.click(within(dal).getByRole('button', { name: 'Save note' }));
    expect(
      await screen.findByText('Instructions can be at most 200 characters.'),
    ).toBeInTheDocument();
  });
});

describe('continuing from the cart', () => {
  it('continues to details when every dish is available', async () => {
    await cartWith({ item: MOCK_DISHES.dal.id });
    await openCart();
    expect(await screen.findByRole('link', { name: 'Continue' })).toHaveAttribute(
      'href',
      '/t/mockQrTable01Active000/details',
    );
  });

  it('asks the customer to remove unavailable dishes first, and says why after a review', async () => {
    setSearchParams('changed=availability');
    mswServer.use(
      http.get('*/customer/cart', () =>
        HttpResponse.json(
          buildCart([
            buildCartLine(MOCK_DISHES.dal, 1, { available: false }),
            buildCartLine(MOCK_DISHES.paneer, 1),
          ]),
        ),
      ),
    );
    await openCart();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Some dishes in your cart are no longer available.',
    );
    expect(screen.getByText('Remove unavailable dishes to continue.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull();
  });
});
