'use client';

import { createContext, useContext, useEffect } from 'react';
import { ApiError } from '@/lib/api/errors';

export type CustomerSessionStage = 'cart' | 'payment' | 'placed' | 'payment_issue';

export type CustomerSessionValue = {
  qrCode: string;
  restaurantName: string;
  tableNumber: string;
  /**
   * `payment` while a payment is in progress (S4), `placed` / `payment_issue`
   * after a verified payment (S5): the cart is locked and the customer belongs on
   * the payment return page.
   */
  stage: CustomerSessionStage;
  /** The backend moved the session to another stage (payment started, checkout released). */
  reportSessionStage: (stage: CustomerSessionStage) => void;
  /**
   * A customer request answered 401: the session ended (5 minutes without
   * activity, F1-02). The boundary explains it and re-enters with the same QR
   * code, like a rescan (technical design §6).
   */
  reportSessionEnded: () => void;
  /** A customer request succeeded, so the session is working. */
  reportSessionWorking: () => void;
};

export const CustomerSessionContext = createContext<CustomerSessionValue | null>(null);

/** The entered session of the current `/t/[qrCode]` page. */
export function useCustomerSession(): CustomerSessionValue {
  const value = useContext(CustomerSessionContext);
  if (!value) throw new Error('useCustomerSession is used outside CustomerSessionBoundary');
  return value;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'unauthorized';
}

/**
 * Reports a query's outcome to the session boundary: a 401 means the session
 * ended; a success means it works.
 */
export function useSessionOutcome(query: {
  error: unknown;
  errorUpdatedAt: number;
  isSuccess: boolean;
  dataUpdatedAt: number;
}) {
  const { reportSessionEnded, reportSessionWorking } = useCustomerSession();
  const { error, errorUpdatedAt, isSuccess, dataUpdatedAt } = query;
  useEffect(() => {
    if (isUnauthorized(error)) reportSessionEnded();
  }, [error, errorUpdatedAt, reportSessionEnded]);
  useEffect(() => {
    if (isSuccess) reportSessionWorking();
  }, [isSuccess, dataUpdatedAt, reportSessionWorking]);
}
