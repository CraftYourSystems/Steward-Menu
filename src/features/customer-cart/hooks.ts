'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { customerKeys } from '@/features/customer-session/query-keys';
import {
  isUnauthorized,
  useCustomerSession,
  useSessionOutcome,
} from '@/features/customer-session/session-context';
import { ApiError } from '@/lib/api/errors';
import { addCartLine, fetchCart, removeCartLine, updateCartLine } from './api';
import { cartProblemFor, type CartProblem } from './cart-problem';
import type { Cart } from './schemas';

/**
 * The session's cart, as the server returns it. Never polled: the only requests
 * are the customer's own (F1-04). A 401 is reported to the session boundary.
 */
export function useCart() {
  const { qrCode } = useCustomerSession();
  const cart = useQuery({
    queryKey: customerKeys.cart(qrCode),
    queryFn: ({ signal }) => fetchCart({ signal }),
    retry: (failureCount, error) =>
      !isUnauthorized(error) &&
      failureCount < 2 &&
      error instanceof ApiError &&
      (error.kind === 'server' || error.kind === 'network'),
  });
  useSessionOutcome(cart);
  return cart;
}

type CartChange =
  | { kind: 'add'; menuItemId: string; quantity: number }
  | { kind: 'set'; lineId: string; quantity: number }
  | { kind: 'instructions'; lineId: string; specialInstructions: string | null }
  | { kind: 'remove'; lineId: string };

function send(change: CartChange): Promise<Cart> {
  switch (change.kind) {
    case 'add':
      return addCartLine(change.menuItemId, change.quantity);
    case 'set':
      return updateCartLine(change.lineId, { quantity: change.quantity });
    case 'instructions':
      return updateCartLine(change.lineId, { specialInstructions: change.specialInstructions });
    case 'remove':
      return removeCartLine(change.lineId);
  }
}

/**
 * Cart changes. The cart shown is always the server's response: nothing is
 * calculated or updated optimistically in the browser. One change at a time
 * (`isPending` disables every control), so responses can never arrive out of
 * order.
 */
export function useCartChanges() {
  const { qrCode, reportSessionEnded, reportSessionWorking } = useCustomerSession();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<CartProblem | null>(null);

  const mutation = useMutation({
    mutationFn: send,
    onMutate: () => setProblem(null),
    onSuccess: (cart) => {
      queryClient.setQueryData(customerKeys.cart(qrCode), cart);
      // Every cart change supersedes the open checkout on the server (S3).
      void queryClient.invalidateQueries({ queryKey: customerKeys.checkout(qrCode) });
      reportSessionWorking();
    },
    onError: (error) => {
      if (isUnauthorized(error)) {
        reportSessionEnded();
        return;
      }
      const next = cartProblemFor(error);
      setProblem(next);
      if (next.kind === 'unavailable' || next.kind === 'gone') {
        void queryClient.invalidateQueries({ queryKey: customerKeys.menu(qrCode) });
        void queryClient.invalidateQueries({ queryKey: customerKeys.cart(qrCode) });
      }
    },
  });

  return {
    add: (menuItemId: string) => mutation.mutate({ kind: 'add', menuItemId, quantity: 1 }),
    setQuantity: (lineId: string, quantity: number) =>
      mutation.mutate({ kind: 'set', lineId, quantity }),
    setInstructions: (lineId: string, specialInstructions: string | null) =>
      mutation.mutate({ kind: 'instructions', lineId, specialInstructions }),
    remove: (lineId: string) => mutation.mutate({ kind: 'remove', lineId }),
    isPending: mutation.isPending,
    problem,
    clearProblem: () => setProblem(null),
  };
}
