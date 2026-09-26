import { useState, useCallback, useEffect } from 'react';
import './App.css';
import { useTheme } from './useTheme';
import { menuItems } from './data/menu';

import Splash       from './screens/Splash';
import MenuScreen   from './screens/Menu';
import ItemDetail   from './screens/ItemDetail';
import Cart         from './screens/Cart';
import Payment      from './screens/Payment';
import Confirmation from './screens/Confirmation';
import OrderStatus  from './screens/OrderStatus';

const SCREENS = {
  SPLASH:       'splash',
  MENU:         'menu',
  ITEM_DETAIL:  'item_detail',
  CART:         'cart',
  PAYMENT:      'payment',
  CONFIRMATION: 'confirmation',
  ORDER_STATUS: 'order_status',
};

function generateOrderId() {
  return 'A' + Math.floor(100 + Math.random() * 900);
}

export default function App() {
  const { dark, toggle } = useTheme();
  const [screen, setScreen] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('screen');
      if (p && Object.values(SCREENS).includes(p)) return p;
    } catch {
      // ignore
    }
    return SCREENS.SPLASH;
  });

  // Cart state with localStorage persistence or mock param
  const [cart, setCart] = useState(() => {
    try {
      const isMock = new URLSearchParams(window.location.search).get('mock') === '1';
      if (isMock) {
        return {
          '1_a2': {
            key: '1_a2',
            item: menuItems[0],
            qty: 1,
            addons: [menuItems[0]?.addons?.[1] || { id: 'a2', name: 'Raita', price: 30 }],
            instructions: 'Make it spicy with less oil',
            unitPrice: 350,
          },
          '2': {
            key: '2',
            item: menuItems[1],
            qty: 2,
            addons: [],
            instructions: '',
            unitPrice: 280,
          }
        };
      }
      const saved = localStorage.getItem('steward_cart');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Orders state with localStorage persistence or mock param
  const [orders, setOrders] = useState(() => {
    try {
      const isMock = new URLSearchParams(window.location.search).get('mock') === '1';
      if (isMock) {
        return [
          {
            id: 'A482',
            table: 3,
            status: 'preparing',
            placedAt: '12:45 PM',
            total: 910,
            itemCount: 3,
            items: [
              {
                key: '1_a2',
                item: menuItems[0],
                qty: 1,
                addons: [menuItems[0]?.addons?.[1] || { id: 'a2', name: 'Raita', price: 30 }],
                instructions: 'Spicy',
                unitPrice: 350,
              },
              {
                key: '2',
                item: menuItems[1],
                qty: 2,
                addons: [],
                instructions: '',
                unitPrice: 280,
              },
            ]
          },
          {
            id: 'A215',
            table: 3,
            status: 'cancelled',
            cancelReason: 'Changed mind / ordered wrong dish',
            cancelledAt: '11:30 AM',
            total: 220,
            itemCount: 1,
            items: [
              {
                key: '3',
                item: menuItems[2],
                qty: 1,
                addons: [],
                instructions: '',
                unitPrice: 220,
              }
            ]
          }
        ];
      }
      const saved = localStorage.getItem('steward_orders');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [activeOrderId, setActiveOrderId] = useState(() => {
    try {
      const pId = new URLSearchParams(window.location.search).get('orderId');
      if (pId) return pId;
      const isMock = new URLSearchParams(window.location.search).get('mock') === '1';
      if (isMock) return 'A482';
      const saved = JSON.parse(localStorage.getItem('steward_orders') || '[]');
      return saved[0]?.id || '';
    } catch {
      return '';
    }
  });



  const [selectedItem, setSelectedItem] = useState(() => {
    try {
      if (new URLSearchParams(window.location.search).get('mock') === '1') return menuItems[0];
    } catch {
      // ignore
    }
    return null;
  });
  const [checkoutData, setCheckoutData] = useState(null);

  // Save to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('steward_cart', JSON.stringify(cart));
    } catch {
      // ignore
    }
  }, [cart]);

  useEffect(() => {
    try {
      localStorage.setItem('steward_orders', JSON.stringify(orders));
    } catch {
      // ignore
    }
  }, [orders]);

  /* ── Cart Operations ─────────────────────── */

  // Quick add/decrement from Menu (+ Add / - / +)
  const handleQuickAdd = useCallback((item, delta) => {
    setCart(prev => {
      const standardKey = String(item.id);
      const existing = prev[standardKey];

      if (delta > 0) {
        if (existing) {
          return {
            ...prev,
            [standardKey]: { ...existing, qty: existing.qty + delta }
          };
        }
        return {
          ...prev,
          [standardKey]: {
            key: standardKey,
            item,
            qty: delta,
            addons: [],
            instructions: '',
            unitPrice: item.price,
          }
        };
      } else {
        // Decrement
        if (existing) {
          const newQty = existing.qty + delta;
          if (newQty <= 0) {
            const { [standardKey]: _, ...rest } = prev;
            return rest;
          }
          return {
            ...prev,
            [standardKey]: { ...existing, qty: newQty }
          };
        }
        // If standard key not found, find any entry with this item.id
        const matchingKey = Object.keys(prev).find(k => prev[k].item.id === item.id);
        if (matchingKey) {
          const newQty = prev[matchingKey].qty + delta;
          if (newQty <= 0) {
            const { [matchingKey]: _, ...rest } = prev;
            return rest;
          }
          return {
            ...prev,
            [matchingKey]: { ...prev[matchingKey], qty: newQty }
          };
        }
        return prev;
      }
    });
  }, []);

  // Add with custom options from ItemDetail screen
  const handleAddToCartWithOptions = useCallback((item, qty, addons = [], instructions = '') => {
    setCart(prev => {
      const addonKey = addons.map(a => a.id).sort().join('_');
      const cleanInst = instructions.trim();
      const key = (addonKey || cleanInst)
        ? `${item.id}_${addonKey}_${cleanInst.replace(/\s+/g, '-').slice(0, 15)}`
        : String(item.id);

      const addonTotal = addons.reduce((sum, a) => sum + a.price, 0);
      const unitPrice = item.price + addonTotal;

      const existing = prev[key];
      const newQty = (existing?.qty ?? 0) + qty;

      return {
        ...prev,
        [key]: {
          key,
          item,
          qty: newQty,
          addons,
          instructions: cleanInst,
          unitPrice,
        }
      };
    });
  }, []);

  // Update specific line item quantity from Cart screen
  const handleUpdateCartQty = useCallback((key, delta) => {
    setCart(prev => {
      const existing = prev[key];
      if (!existing) return prev;
      const newQty = existing.qty + delta;
      if (newQty <= 0) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [key]: { ...existing, qty: newQty }
      };
    });
  }, []);

  const cartCount = Object.values(cart).reduce((s, { qty }) => s + qty, 0);

  /* ── Navigation & Flow ───────────────────── */
  const go = useCallback((s) => setScreen(s), []);

  const handleTapItem = useCallback((item) => {
    setSelectedItem(item);
    go(SCREENS.ITEM_DETAIL);
  }, [go]);

  const handleCheckout = useCallback((data) => {
    setCheckoutData(data);
    go(SCREENS.PAYMENT);
  }, [go]);

  const handlePay = useCallback((paymentMethod = 'UPI') => {
    const newOrderId = generateOrderId();
    const orderItems = Object.values(cart);
    const subtotal = checkoutData?.subtotal || orderItems.reduce((s, e) => s + (e.unitPrice || e.item.price) * e.qty, 0);
    const tax = checkoutData?.tax || Math.round(subtotal * 0.05);
    const total = checkoutData?.total || (subtotal + tax);

    const now = new Date();
    const newOrder = {
      id: newOrderId,
      items: orderItems,
      subtotal,
      tax,
      total,
      paymentMethod,
      createdAt: now.toISOString(),
      createdAtFormatted: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      dateFormatted: now.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      restaurantName: 'Spice Court',
      tableNumber: 3,
      status: 'preparing',
      step: 1,
      eta: '12–15 min',
    };

    setOrders(prev => [newOrder, ...prev]);
    setActiveOrderId(newOrderId);
    setCart({}); // Cart is cleared upon successful order placement
    go(SCREENS.CONFIRMATION);
  }, [cart, checkoutData, go]);

  const handleCancelOrder = useCallback((orderId, reason = '') => {
    const now = new Date();
    setOrders(prev =>
      prev.map(order =>
        order.id === orderId
          ? {
              ...order,
              status: 'cancelled',
              cancelReason: reason || 'Cancelled by guest',
              cancelledAt: now.toISOString(),
              cancelledAtFormatted: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            }
          : order
      )
    );
  }, []);

  const handleReorder = useCallback((order) => {
    setCart(prev => {
      const updated = { ...prev };
      (order.items || []).forEach(orderItem => {
        const key = orderItem.key || String(orderItem.item.id);
        if (updated[key]) {
          updated[key] = {
            ...updated[key],
            qty: updated[key].qty + orderItem.qty,
          };
        } else {
          updated[key] = { ...orderItem };
        }
      });
      return updated;
    });
    go(SCREENS.CART);
  }, [go]);

  /* ── Render ─────────────────────────────── */
  const renderScreen = () => {
    switch (screen) {
      case SCREENS.SPLASH:
        return <Splash onEnter={() => go(SCREENS.MENU)} dark={dark} onToggleTheme={toggle} />;

      case SCREENS.MENU:
        return (
          <MenuScreen
            cart={cart}
            onAdd={handleQuickAdd}
            onGoCart={() => go(SCREENS.CART)}
            onTapItem={handleTapItem}
            dark={dark}
            onToggleTheme={toggle}
          />
        );

      case SCREENS.ITEM_DETAIL:
        return (
          <ItemDetail
            item={selectedItem}
            onAddToCart={handleAddToCartWithOptions}
            onBack={() => go(SCREENS.MENU)}
          />
        );

      case SCREENS.CART:
        return (
          <Cart
            cart={cart}
            onUpdateQty={handleUpdateCartQty}
            onBack={() => go(SCREENS.MENU)}
            onCheckout={handleCheckout}
          />
        );

      case SCREENS.PAYMENT:
        return (
          <Payment
            total={checkoutData?.total || 0}
            onBack={() => go(SCREENS.CART)}
            onPay={handlePay}
          />
        );

      case SCREENS.CONFIRMATION:
        return (
          <Confirmation
            orderId={activeOrderId}
            onTrack={() => go(SCREENS.ORDER_STATUS)}
            onBackToMenu={() => go(SCREENS.MENU)}
          />
        );

      case SCREENS.ORDER_STATUS:
        return (
          <OrderStatus
            orders={orders}
            activeOrderId={activeOrderId}
            onSelectOrder={setActiveOrderId}
            onBackToMenu={() => go(SCREENS.MENU)}
            onReorder={handleReorder}
            onCancelOrder={handleCancelOrder}
          />
        );

      default:
        return null;
    }
  };

  const showBottomNav = [SCREENS.MENU, SCREENS.CART, SCREENS.ORDER_STATUS].includes(screen);

  return (
    <div className="app">
      <div key={screen} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {renderScreen()}
      </div>

      {showBottomNav && (
        <nav className="bottom-nav">
          <button
            className={`bottom-nav__item${screen === SCREENS.MENU ? ' active' : ''}`}
            onClick={() => go(SCREENS.MENU)}
          >
            <span className="bottom-nav__icon">🍽️</span>
            <span>Menu</span>
          </button>
          <button
            className={`bottom-nav__item${screen === SCREENS.CART ? ' active' : ''}`}
            onClick={() => go(SCREENS.CART)}
          >
            <span className="bottom-nav__icon">🛒</span>
            {cartCount > 0 && <span className="bottom-nav__badge">{cartCount}</span>}
            <span>Cart</span>
          </button>
          <button
            className={`bottom-nav__item${screen === SCREENS.ORDER_STATUS ? ' active' : ''}`}
            onClick={() => go(SCREENS.ORDER_STATUS)}
          >
            <span className="bottom-nav__icon">📋</span>
            {orders.length > 0 && (
              <span className="bottom-nav__badge bottom-nav__badge--brand">{orders.length}</span>
            )}
            <span>Orders</span>
          </button>
        </nav>
      )}
    </div>
  );
}
