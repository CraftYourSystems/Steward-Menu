import { useState } from 'react';
import './Payment.css';

const METHODS = [
  { id: 'upi',  icon: '📱', label: 'UPI',  sub: 'Pay using any UPI app' },
  { id: 'card', icon: '💳', label: 'Card', sub: 'Visa, Mastercard, Rupay' },
  { id: 'cash', icon: '💵', label: 'Cash', sub: 'Pay at counter' },
];

export default function Payment({ total, onBack, onPay }) {
  const [selected, setSelected] = useState('upi');
  const [paying, setPaying] = useState(false);

  const handlePay = () => {
    setPaying(true);
    const methodObj = METHODS.find(m => m.id === selected);
    setTimeout(() => {
      setPaying(false);
      onPay(methodObj?.label || 'UPI');
    }, 1200);
  };

  return (
    <div className="screen payment-screen">
      <div className="top-bar">
        <button className="top-bar__back" onClick={onBack} disabled={paying}>←</button>
        <span className="top-bar__title">Payment</span>
        <div style={{ width: 36 }} />
      </div>

      <div className="screen-scroll">
        <div className="payment-body">
          {/* Amount */}
          <div className="payment-amount">
            <p className="payment-amount__label">Total Amount</p>
            <p className="payment-amount__value">₹{total}</p>
          </div>

          {/* Methods */}
          <h4 className="payment-section-title">Select Payment Method</h4>
          <div className="payment-methods">
            {METHODS.map(m => (
              <button
                key={m.id}
                className={`payment-method${selected === m.id ? ' active' : ''}`}
                onClick={() => setSelected(m.id)}
              >
                <span className="payment-method__icon">{m.icon}</span>
                <div className="payment-method__text">
                  <span className="payment-method__label">{m.label}</span>
                  <span className="payment-method__sub">{m.sub}</span>
                </div>
                <div className={`payment-method__radio${selected === m.id ? ' active' : ''}`}>
                  {selected === m.id && <div className="payment-method__radio-dot" />}
                </div>
              </button>
            ))}
          </div>

          <div className="payment-secure">
            <span>🔒</span>
            <p>Your payment is secure</p>
          </div>
        </div>

        <div style={{ height: 100 }} />
      </div>

      {/* Pay button */}
      <div className="payment-footer">
        {paying ? (
          <div className="payment-processing">
            <div className="payment-spinner" />
            <span>Processing payment…</span>
          </div>
        ) : (
          <button className="btn btn-confirm" onClick={handlePay}>
            Pay ₹{total}
          </button>
        )}
      </div>
    </div>
  );
}
