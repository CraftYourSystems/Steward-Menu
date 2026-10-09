/**
 * Leaves the application for the payment gateway (F-01 S4): a full-page
 * navigation to the backend-issued redirect URL, which is validated as http(s)
 * at the API boundary. Kept in one place so tests can observe it.
 */
export function leaveForPayment(redirectUrl: string): void {
  window.location.assign(redirectUrl);
}
