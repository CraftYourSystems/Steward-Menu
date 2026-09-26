import { useEffect, useState } from 'react';
import './Confirmation.css';

export default function Confirmation({ orderId, onTrack, onBackToMenu }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 100); return () => clearTimeout(t); }, []);

  return (
    <div className="screen confirmation-screen">
      <div className="confirmation-body">
        <div className={`confirmation-check${show ? ' visible' : ''}`}>
          <div className="confirmation-check__ring confirmation-check__ring--outer" />
          <div className="confirmation-check__ring confirmation-check__ring--inner" />
          <div className="confirmation-check__icon">✓</div>
        </div>

        <div className={`confirmation-text${show ? ' visible' : ''}`}>
          <h2 className="confirmation-title">Order Confirmed!</h2>
          <p className="confirmation-order-id">Order #{orderId}</p>
          <p className="confirmation-restaurant">Spice Court</p>
          <p className="confirmation-desc">
            Your order has been received and is being prepared in the kitchen.
          </p>
        </div>

        <div className={`confirmation-eta${show ? ' visible' : ''}`}>
          <div className="eta-card">
            <span className="eta-card__icon">⏱</span>
            <div>
              <p className="eta-card__label">Estimated Time</p>
              <p className="eta-card__value">12–15 minutes</p>
            </div>
          </div>
        </div>

        <div className={`confirmation-actions${show ? ' visible' : ''}`}>
          <button className="btn btn-primary" onClick={onTrack}>
            Track Order Status
          </button>
          <button className="btn btn-secondary" onClick={onBackToMenu}>
            Back to Menu
          </button>
          <p className="confirmation-notify">
            We'll notify you when your order is ready to serve
          </p>
        </div>
      </div>
    </div>
  );
}
