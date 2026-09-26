import { useState, useMemo } from 'react';
import { menuItems, categories, restaurant, recommended } from '../data/menu';
import './Menu.css';

/* ── Horizontal featured card ───────────── */
function FeaturedCard({ item, onAdd, onTap, cartQty }) {
  const gradients = [
    'linear-gradient(145deg, #074A43 0%, #0A665E 60%, #0E8E83 100%)',
    'linear-gradient(145deg, #0B2522 0%, #0F3833 60%, #0A665E 100%)',
    'linear-gradient(145deg, #083E38 0%, #0C5E55 60%, #109E92 100%)',
    'linear-gradient(145deg, #0A2F2B 0%, #064E46 100%)',
  ];
  const bg = gradients[item.id % gradients.length];

  return (
    <div className="featured-card" onClick={() => onTap(item)}>
      <div className="featured-card__hero">
        <span className="featured-card__emoji">{item.emoji}</span>
        <div className="featured-card__badges">
          {item.isBestseller && <span className="chip chip-brand">Bestseller</span>}
          {item.isChefSpecial && <span className="chip chip-mist">Chef's Special</span>}
        </div>
      </div>
      <div className="featured-card__body">
        <div className="featured-card__top">
          <span className={`veg-dot ${item.isVeg ? 'veg' : 'nonveg'}`} />
          <p className="featured-card__name">{item.name}</p>
        </div>
        <p className="featured-card__desc">{item.description}</p>
        <div className="featured-card__footer">
          <span className="featured-card__price">₹{item.price}</span>
          {cartQty > 0 ? (
            <div className="qty-ctrl qty-ctrl--sm" onClick={e => e.stopPropagation()}>
              <button className="qty-ctrl__btn" onClick={() => onAdd(item, -1)}>−</button>
              <span className="qty-ctrl__val">{cartQty}</span>
              <button className="qty-ctrl__btn qty-ctrl__btn--add" onClick={() => onAdd(item, 1)}>+</button>
            </div>
          ) : (
            <button
              className="btn-add-pill"
              onClick={e => { e.stopPropagation(); onAdd(item, 1); }}
            >+ Add</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── List item row ──────────────────────── */
function MenuRow({ item, onAdd, onTap, cartQty }) {
  return (
    <div className="menu-row" onClick={() => onTap(item)}>
      <div className="menu-row__emoji-wrap">
        <span className="menu-row__emoji">{item.emoji}</span>
      </div>
      <div className="menu-row__info">
        <div className="menu-row__meta">
          <span className={`veg-dot ${item.isVeg ? 'veg' : 'nonveg'}`} />
          {item.isBestseller && <span className="chip chip-brand">Bestseller</span>}
          {item.isChefSpecial && <span className="chip chip-mist">Chef's Special</span>}
        </div>
        <p className="menu-row__name">{item.name}</p>
        <p className="menu-row__desc">{item.description}</p>
        <div className="menu-row__footer">
          <span className="menu-row__price">₹{item.price}</span>
          {cartQty > 0 ? (
            <div className="qty-ctrl" onClick={e => e.stopPropagation()}>
              <button className="qty-ctrl__btn" onClick={() => onAdd(item, -1)}>−</button>
              <span className="qty-ctrl__val">{cartQty}</span>
              <button className="qty-ctrl__btn qty-ctrl__btn--add" onClick={() => onAdd(item, 1)}>+</button>
            </div>
          ) : (
            <button
              className="btn-add-small"
              onClick={e => { e.stopPropagation(); onAdd(item, 1); }}
            >+ Add</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MenuScreen({ cart, onAdd, onGoCart, onTapItem, dark, onToggleTheme }) {
  const [activeCategory, setActiveCategory] = useState('all');
  const [search, setSearch] = useState('');

  const cartTotal = Object.values(cart).reduce((s, e) => s + (e.unitPrice || e.item.price) * e.qty, 0);
  const cartCount = Object.values(cart).reduce((s, e) => s + e.qty, 0);

  const filtered = useMemo(() => {
    let items = activeCategory === 'all'
      ? menuItems
      : menuItems.filter(i => i.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(i =>
        i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
      );
    }
    return items;
  }, [activeCategory, search]);

  const getQty = id => Object.values(cart).filter(e => e.item.id === id).reduce((s, e) => s + e.qty, 0);

  return (
    <div className="screen menu-screen">

      {/* ── Header ────────────────────────── */}
      <div className="menu-header">
        <div className="menu-header__top">
          <div className="menu-header__brand">
            <p className="menu-header__welcome">Welcome to</p>
            <h2 className="menu-header__restaurant">{restaurant.name}</h2>
          </div>
          <div className="menu-header__controls">
            <button className="theme-toggle" onClick={onToggleTheme} aria-label="Toggle theme">
              <span className="theme-toggle__icon">{dark ? '☀️' : '🌙'}</span>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="menu-search">
          <span className="menu-search__icon">🔍</span>
          <input
            className="menu-search__input"
            type="text"
            placeholder="Search dishes, ingredients…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="menu-search__clear" onClick={() => setSearch('')}>✕</button>
          )}
        </div>

        {/* Categories */}
        <div className="menu-cats">
          {categories.map(c => (
            <button
              key={c.id}
              className={`menu-cat${activeCategory === c.id ? ' active' : ''}`}
              onClick={() => setActiveCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scroll area ───────────────────── */}
      <div className="screen-scroll">

        {/* Recommended — horizontal scroll cards */}
        {activeCategory === 'all' && !search && (
          <div className="menu-section-featured">
            <div className="menu-section-head">
              <div>
                <p className="menu-section-label">Hand-picked</p>
                <h3 className="menu-section-title">Recommended</h3>
              </div>
              <button className="menu-see-all">See all →</button>
            </div>
            <div className="featured-scroll">
              {recommended.map(item => (
                <FeaturedCard
                  key={item.id}
                  item={item}
                  onAdd={onAdd}
                  onTap={onTapItem}
                  cartQty={getQty(item.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Full menu list */}
        <div className="menu-section-list">
          {!search && activeCategory === 'all' && (
            <div className="menu-section-head" style={{ padding: '0 var(--space-5)' }}>
              <div>
                <p className="menu-section-label">Complete selection</p>
                <h3 className="menu-section-title">Full Menu</h3>
              </div>
            </div>
          )}

          {filtered.length === 0 && (
            <div className="menu-empty">
              <span>🍽️</span>
              <p className="menu-empty__title">Nothing found</p>
              <p className="menu-empty__sub">Try a different search or category</p>
            </div>
          )}

          <div className="menu-rows">
            {filtered.map(item => (
              <MenuRow
                key={item.id}
                item={item}
                onAdd={onAdd}
                onTap={onTapItem}
                cartQty={getQty(item.id)}
              />
            ))}
          </div>
        </div>

        <div style={{ height: cartCount > 0 ? 100 : 32 }} />
      </div>

      {/* ── Cart bar ──────────────────────── */}
      {cartCount > 0 && (
        <div className="cart-bar" onClick={onGoCart}>
          <div className="cart-bar__left">
            <div className="cart-bar__count-pill">{cartCount}</div>
            <span className="cart-bar__label">View Cart</span>
          </div>
          <div className="cart-bar__right">
            <span className="cart-bar__total">₹{cartTotal}</span>
            <span className="cart-bar__arrow">→</span>
          </div>
        </div>
      )}
    </div>
  );
}
