import './Cart.css';

export default function Cart({ cart, onUpdateQty, onBack, onCheckout }) {
  const items = Object.values(cart);
  const subtotal = items.reduce((s, entry) => s + (entry.unitPrice || entry.item.price) * entry.qty, 0);
  const tax = Math.round(subtotal * 0.05);
  const total = subtotal + tax;

  if (items.length === 0) {
    return (
      <div className="screen cart-screen">
        <div className="top-bar">
          <button className="top-bar__back" onClick={onBack}>←</button>
          <span className="top-bar__title">Your Cart</span>
          <div style={{ width: 36 }} />
        </div>
        <div className="cart-empty">
          <span className="cart-empty__icon">🛒</span>
          <h3 className="cart-empty__title">Your cart is empty</h3>
          <p className="cart-empty__desc">Add some delicious items to get started.</p>
          <button className="btn btn-primary" style={{ width: 'auto', padding: '0.7rem 2rem' }} onClick={onBack}>
            Browse Menu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen cart-screen">
      <div className="top-bar">
        <button className="top-bar__back" onClick={onBack}>←</button>
        <span className="top-bar__title">Your Cart</span>
        <button className="top-bar__action" onClick={onBack}>+ Add More</button>
      </div>

      <div className="screen-scroll">
        {/* Items */}
        <div className="cart-items">
          {items.map((entry) => {
            const key = entry.key || String(entry.item.id);
            const unitPrice = entry.unitPrice || entry.item.price;
            const { item, qty, addons = [], instructions } = entry;

            return (
              <div key={key} className="cart-item">
                <div className="cart-item__emoji">{item.emoji}</div>
                <div className="cart-item__info">
                  <p className="cart-item__name">{item.name}</p>
                  {addons.length > 0 && (
                    <p className="cart-item__addons">
                      + {addons.map(a => `${a.name} (₹${a.price})`).join(', ')}
                    </p>
                  )}
                  {instructions && (
                    <p className="cart-item__instructions">
                      Note: "{instructions}"
                    </p>
                  )}
                  <p className="cart-item__price">₹{unitPrice} each</p>
                </div>
                <div className="qty-ctrl">
                  <button className="qty-ctrl__btn" onClick={() => onUpdateQty(key, -1)}>−</button>
                  <span className="qty-ctrl__val">{qty}</span>
                  <button className="qty-ctrl__btn qty-ctrl__btn--add" onClick={() => onUpdateQty(key, 1)}>+</button>
                </div>
                <div className="cart-item__total">₹{unitPrice * qty}</div>
              </div>
            );
          })}
        </div>

        <div className="divider" />

        {/* Bill */}
        <div className="cart-bill">
          <h4 className="cart-bill__title">Bill Details</h4>
          <div className="cart-bill__rows">
            <div className="cart-bill__row">
              <span>Item Total</span>
              <span>₹{subtotal}</span>
            </div>
            <div className="cart-bill__row">
              <span>Taxes (5%)</span>
              <span>₹{tax}</span>
            </div>
            <div className="cart-bill__row cart-bill__row--total">
              <span>Total</span>
              <span>₹{total}</span>
            </div>
          </div>
        </div>

        {/* Safety note */}
        <div className="cart-note">
          <span>🔒</span>
          <p>Your payment is secure and encrypted</p>
        </div>

        <div style={{ height: 100 }} />
      </div>

      {/* CTA */}
      <div className="cart-footer">
        <button className="btn btn-confirm" onClick={() => onCheckout({ subtotal, tax, total, items })}>
          Proceed to Pay · ₹{total}
        </button>
      </div>
    </div>
  );
}
