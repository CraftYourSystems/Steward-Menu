import { useState, useEffect } from 'react';
import './OrderStatus.css';

const STEPS = [
  { id: 'received',   label: 'Order confirmed',      sub: 'Kitchen accepted your order' },
  { id: 'preparing',  label: 'Preparing your food',  sub: 'Chef is crafting your meal' },
  { id: 'ready',      label: 'Ready to serve',       sub: 'Plated & fresh from tandoor' },
  { id: 'served',     label: 'Served to table',      sub: 'Delivered to Table 3 · Enjoy!' },
];

export default function OrderStatus({
  orders = [],
  activeOrderId,
  onSelectOrder,
  onBackToMenu,
  onReorder,
  onCancelOrder
}) {
  const [activeStep, setActiveStep] = useState(1);
  const [showCancelModal, setShowCancelModal] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('cancelModal') === '1';
    } catch {
      return false;
    }
  });
  const [cancelReason, setCancelReason] = useState('Changed my mind');

  // If activeOrderId is provided, find it; otherwise pick the newest order
  const currentOrder = orders.find(o => o.id === activeOrderId) || orders[0];
  const isCancelled = currentOrder?.status === 'cancelled';

  useEffect(() => {
    if (isCancelled) return;
    // Reset or start step progress for the current active order
    setActiveStep(1);
    const t = setInterval(() => {
      setActiveStep(s => Math.min(s + 1, STEPS.length - 1));
    }, 6000);
    return () => clearInterval(t);
  }, [currentOrder?.id, isCancelled]);

  if (!currentOrder || orders.length === 0) {
    return (
      <div className="screen order-status-screen">
        <div className="top-bar">
          <div style={{ width: 36 }} />
          <span className="top-bar__title">My Orders</span>
          <div style={{ width: 36 }} />
        </div>
        <div className="os-empty">
          <span className="os-empty__icon">📋</span>
          <h3 className="os-empty__title">No orders yet</h3>
          <p className="os-empty__desc">
            You haven't placed any orders yet. Discover delicious dishes from the menu!
          </p>
          <button className="btn btn-primary" style={{ width: 'auto', padding: '0.8rem 2.2rem' }} onClick={onBackToMenu}>
            Browse Menu
          </button>
        </div>
      </div>
    );
  }

  const orderItems = currentOrder.items || [];
  const itemCount = orderItems.reduce((s, e) => s + e.qty, 0);

  return (
    <div className="screen order-status-screen">
      <div className="top-bar">
        <button className="top-bar__back" onClick={onBackToMenu}>←</button>
        <span className="top-bar__title">Order Status</span>
        <button className="top-bar__action" onClick={onBackToMenu}>+ Add More</button>
      </div>

      <div className="screen-scroll">
        {/* Header card */}
        <div className="os-header-card">
          <div className="os-header-card__left">
            <p className="os-header-card__id">Order #{currentOrder.id}</p>
            <p className="os-header-card__restaurant">
              {currentOrder.restaurantName || 'Spice Court'} · Table {currentOrder.tableNumber || 3}
            </p>
            <p className="os-header-card__time">
              Placed at {currentOrder.createdAtFormatted || 'Just now'}
            </p>
          </div>
          <div className="os-header-card__eta">
            <p className="os-header-card__eta-label">Status</p>
            <div className="os-header-card__eta-value">
              {isCancelled ? (
                <span className="os-badge-cancelled">Cancelled</span>
              ) : activeStep >= 3 ? (
                'Served'
              ) : activeStep === 2 ? (
                '2–3 min'
              ) : (
                currentOrder.eta || '10–12 min'
              )}
            </div>
          </div>
        </div>

        {/* Cancelled Banner if order was cancelled */}
        {isCancelled && (
          <div className="os-cancelled-banner">
            <div className="os-cancelled-banner__icon">✕</div>
            <div className="os-cancelled-banner__text">
              <h4 className="os-cancelled-banner__title">Order Cancelled</h4>
              <p className="os-cancelled-banner__desc">
                This order was cancelled at {currentOrder.cancelledAtFormatted || 'recent'}. {currentOrder.cancelReason ? `Reason: ${currentOrder.cancelReason}. ` : ''}A full refund of ₹{currentOrder.total} is being returned to your original payment method ({currentOrder.paymentMethod || 'UPI'}).
              </p>
            </div>
          </div>
        )}

        {/* Progress steps (only shown when not cancelled) */}
        {!isCancelled && (
          <div className="os-steps">
            {STEPS.map((step, i) => {
              const isDone   = i < activeStep;
              const isActive = i === activeStep;
              return (
                <div key={step.id} className={`os-step${isDone ? ' done' : ''}${isActive ? ' active' : ''}`}>
                  {i < STEPS.length - 1 && <div className="os-step__line" />}
                  <div className="os-step__dot">
                    {isDone ? '✓' : isActive ? <div className="os-step__pulse" /> : ''}
                  </div>
                  <div className="os-step__content">
                    <p className="os-step__label">{step.label}</p>
                    <p className="os-step__sub">{step.sub}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="divider" />

        {/* Order summary */}
        <div className="os-summary">
          <h4 className="os-summary__title">Your Order ({itemCount} {itemCount === 1 ? 'item' : 'items'})</h4>
          <div className="os-summary__items">
            {orderItems.map((entry, index) => {
              const unitPrice = entry.unitPrice || entry.item.price;
              const addons = entry.addons || [];
              return (
                <div key={entry.key || `${entry.item.id}-${index}`} className="os-summary__row">
                  <span className="os-summary__qty">{entry.qty}×</span>
                  <div className="os-summary__info">
                    <span className="os-summary__name">{entry.item.name}</span>
                    {addons.length > 0 && (
                      <span className="os-summary__addons">
                        + {addons.map(a => a.name).join(', ')}
                      </span>
                    )}
                    {entry.instructions && (
                      <span className="os-summary__note">
                        Note: "{entry.instructions}"
                      </span>
                    )}
                  </div>
                  <span className="os-summary__price">₹{unitPrice * entry.qty}</span>
                </div>
              );
            })}
          </div>

          {/* Bill breakdown */}
          {(() => {
            const calculatedSubtotal = currentOrder.subtotal ?? (currentOrder.items || []).reduce((acc, it) => acc + (it.unitPrice || it.item.price) * it.qty, 0);
            const calculatedTax = currentOrder.tax ?? Math.round(calculatedSubtotal * 0.05);
            return (
              <div className="os-bill">
                <div className="os-bill__row">
                  <span>Item Total</span>
                  <span>₹{calculatedSubtotal}</span>
                </div>
                <div className="os-bill__row">
                  <span>Taxes (5%)</span>
                  <span>₹{calculatedTax}</span>
                </div>
                <div className="os-bill__row os-bill__row--total">
                  <span>{isCancelled ? 'Refund Amount' : 'Total Paid'}</span>
                  <span>₹{currentOrder.total} ({currentOrder.paymentMethod || 'UPI'})</span>
                </div>
              </div>
            );
          })()}

        </div>

        {/* If user has multiple orders */}
        {orders.length > 1 && (
          <div className="os-past-section">
            <h4 className="os-past-title">All Orders ({orders.length})</h4>
            {orders.map(order => {
              const isSelected = order.id === currentOrder.id;
              const isPastCancelled = order.status === 'cancelled';
              const count = (order.items || []).reduce((s, e) => s + e.qty, 0);
              return (
                <div
                  key={order.id}
                  className={`os-past-card${isSelected ? ' active' : ''}`}
                  onClick={() => onSelectOrder?.(order.id)}
                >
                  <div className="os-past-card__left">
                    <p className="os-past-card__id">
                      Order #{order.id}
                      {isSelected && <span className="os-past-card__current-tag">Viewing</span>}
                      {isPastCancelled && <span className="os-past-card__cancelled-tag">Cancelled</span>}
                    </p>
                    <p className="os-past-card__meta">
                      {order.dateFormatted || 'Today'} at {order.createdAtFormatted} · {count} {count === 1 ? 'item' : 'items'} · ₹{order.total}
                    </p>
                  </div>
                  <button
                    className="btn-reorder"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReorder?.(order);
                    }}
                  >
                    Reorder
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ height: 100 }} />
      </div>

      <div className="os-footer">
        {isCancelled ? (
          <>
            <button className="btn btn-secondary" onClick={onBackToMenu}>
              Order More Dishes
            </button>
            <button className="btn btn-primary" onClick={() => onReorder?.(currentOrder)}>
              Reorder This
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-cancel-outline" onClick={() => setShowCancelModal(true)}>
              Cancel Order
            </button>
            <button className="btn btn-primary" onClick={onBackToMenu}>
              + Add More Dishes
            </button>
          </>
        )}
      </div>

      {/* Cancel Order Confirmation Modal */}
      {showCancelModal && (
        <div className="os-modal-overlay" onClick={() => setShowCancelModal(false)}>
          <div className="os-modal" onClick={e => e.stopPropagation()}>
            <div className="os-modal__icon">⚠️</div>
            <h3 className="os-modal__title">Cancel Order #{currentOrder.id}?</h3>
            <p className="os-modal__desc">
              Are you sure you want to cancel this order? The kitchen will be notified immediately to stop preparation.
            </p>

            <div className="os-modal__reasons">
              <p className="os-modal__reasons-label">Reason for cancellation:</p>
              {[
                'Changed my mind',
                'Ordered incorrect items',
                'Taking longer than expected',
                'Want to reorder with changes',
              ].map(reason => (
                <button
                  key={reason}
                  type="button"
                  className={`os-reason-chip${cancelReason === reason ? ' active' : ''}`}
                  onClick={() => setCancelReason(reason)}
                >
                  {reason}
                </button>
              ))}
            </div>

            <div className="os-modal__actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCancelModal(false)}
              >
                Keep Order
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  onCancelOrder?.(currentOrder.id, cancelReason);
                  setShowCancelModal(false);
                }}
              >
                Yes, Cancel Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
