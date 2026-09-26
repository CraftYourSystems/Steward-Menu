import { useState } from 'react';
import './ItemDetail.css';

const spiceLabels = { mild: 'Mild', medium: 'Medium', spicy: 'Spicy' };

export default function ItemDetail({ item, onAddToCart, onBack }) {
  const [selectedAddons, setSelectedAddons] = useState([]);
  const [qty, setQty] = useState(1);
  const [instructions, setInstructions] = useState('');

  if (!item) return null;

  const toggleAddon = (addon) => {
    setSelectedAddons(prev =>
      prev.find(a => a.id === addon.id)
        ? prev.filter(a => a.id !== addon.id)
        : [...prev, addon]
    );
  };

  const addonTotal = selectedAddons.reduce((s, a) => s + a.price, 0);
  const total = (item.price + addonTotal) * qty;

  const handleAdd = () => {
    onAddToCart(item, qty, selectedAddons, instructions);
    onBack();
  };

  return (
    <div className="screen item-detail">
      {/* Hero */}
      <div className="item-detail__hero">
        <button className="item-detail__back" onClick={onBack}>←</button>
        <div className="item-detail__emoji">{item.emoji}</div>
        <div className="item-detail__hero-badges">
          {item.isBestseller && <span className="chip chip-brand">Bestseller</span>}
          {item.isChefSpecial && <span className="chip chip-mist">Chef's Special</span>}
        </div>
      </div>

      {/* Content */}
      <div className="screen-scroll">
        <div className="item-detail__body">
          <div className="item-detail__top">
            <span className={`veg-dot ${item.isVeg ? 'veg' : 'nonveg'}`} />
            <h2 className="item-detail__name">{item.name}</h2>
            <p className="item-detail__price">₹{item.price}</p>
            <p className="item-detail__desc">{item.description}</p>
          </div>

          {/* Spice Level */}
          {item.spiceLevel && (
            <div className="item-detail__section">
              <h4 className="item-detail__section-title">Spice Level</h4>
              <div className="spice-row">
                {['mild', 'medium', 'spicy'].map(level => (
                  <span
                    key={level}
                    className={`spice-chip${item.spiceLevel === level ? ' active' : ''}`}
                  >
                    {spiceLabels[level]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Quantity */}
          <div className="item-detail__section">
            <h4 className="item-detail__section-title">Quantity</h4>
            <div className="item-detail__qty">
              <button className="qty-lg__btn" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
              <span className="qty-lg__val">{qty}</span>
              <button className="qty-lg__btn qty-lg__btn--add" onClick={() => setQty(q => q + 1)}>+</button>
            </div>
          </div>

          {/* Add-ons */}
          {item.addons.length > 0 && (
            <div className="item-detail__section">
              <h4 className="item-detail__section-title">Add-ons <span className="item-detail__optional">Optional</span></h4>
              {item.addons.map(addon => {
                const checked = !!selectedAddons.find(a => a.id === addon.id);
                return (
                  <label key={addon.id} className="addon-row">
                    <div className="addon-row__info">
                      <span className="addon-row__name">{addon.name}</span>
                      <span className="addon-row__price">+₹{addon.price}</span>
                    </div>
                    <div className={`addon-check${checked ? ' checked' : ''}`}
                      onClick={() => toggleAddon(addon)}>
                      {checked && '✓'}
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {/* Special Instructions */}
          <div className="item-detail__section">
            <h4 className="item-detail__section-title">Special Instructions <span className="item-detail__optional">Optional</span></h4>
            <textarea
              className="item-detail__instructions"
              placeholder="E.g. no onion, extra spicy…"
              rows={2}
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
            />
          </div>

          <div style={{ height: 100 }} />
        </div>
      </div>

      {/* Add to cart */}
      <div className="item-detail__footer">
        <div className="item-detail__footer-total">
          <span className="item-detail__footer-label">Total</span>
          <span className="item-detail__footer-amount">₹{total}</span>
        </div>
        <button className="btn btn-primary" onClick={handleAdd}>
          Add to Cart · ₹{total}
        </button>
      </div>
    </div>
  );
}
