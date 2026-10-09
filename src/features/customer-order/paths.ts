/** The order page of a placed order (F-01 S6, route map): `/t/{qr}/orders/{orderRef}`. */
export function orderPagePath(qrCode: string, orderRef: string): string {
  return `/t/${encodeURIComponent(qrCode)}/orders/${encodeURIComponent(orderRef)}`;
}
