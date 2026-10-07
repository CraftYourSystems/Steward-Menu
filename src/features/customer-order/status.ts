import { ORDER_STATUSES, type CustomerOrder, type OrderStatus } from './schemas';

/** What the customer reads for each state (F-01 S6; the status SMS copy matches). */
export const STATUS_COPY: Record<OrderStatus, { label: string; description: string }> = {
  placed: { label: 'Order received', description: 'The restaurant has your order.' },
  cooking: { label: 'Being prepared', description: 'Your order is being prepared.' },
  ready_to_serve: { label: 'Ready', description: 'Your order is ready.' },
  completed: { label: 'Completed', description: 'Your order is complete. Enjoy your meal!' },
};

export function statusRank(status: OrderStatus): number {
  return ORDER_STATUSES.indexOf(status);
}

/**
 * The order to show: never one whose status is behind what is already shown.
 * Responses can arrive out of order (a slow refetch overtaken by a later one);
 * the lifecycle only ever moves forward (Placed → Cooking → Ready → Completed).
 */
export function newerOrder(
  shown: CustomerOrder | undefined,
  incoming: CustomerOrder,
): CustomerOrder {
  if (shown && shown.orderRef === incoming.orderRef) {
    if (statusRank(incoming.status) < statusRank(shown.status)) return shown;
  }
  return incoming;
}
