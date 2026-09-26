import './Splash.css';

export default function Splash({ onEnter, dark, onToggleTheme }) {
  return (
    <div className="splash screen">
      {/* Theme toggle */}
      <button className="splash__theme-toggle" onClick={onToggleTheme} aria-label="Toggle theme">
        {dark ? '☀️' : '🌙'}
      </button>

      {/* Floating hero plate */}
      <div className="splash__hero">
        <div className="splash__plate">
          <span className="splash__plate-emoji">🍛</span>
          <div className="splash__plate-ring" />
        </div>
      </div>

      {/* Bottom content sheet */}
      <div className="splash__content">
        <div className="splash__top">
          <p className="splash__eyebrow">Table 3 · Dine In</p>
          <h1 className="splash__wordmark">Steward</h1>
          <p className="splash__tagline">Good food. Better experiences.</p>
        </div>

        <div className="splash__features">
          {[
            { icon: '🍽️', label: 'Easy Ordering' },
            { icon: '⚡', label: 'Quick & Secure' },
            { icon: '👨‍🍳', label: 'Freshly Prepared' },
            { icon: '🛡️', label: 'Trusted' },
          ].map(f => (
            <div key={f.label} className="splash__feature">
              <span className="splash__feature-icon">{f.icon}</span>
              <span className="splash__feature-label">{f.label}</span>
            </div>
          ))}
        </div>

        <div className="splash__actions">
          <button className="btn splash__cta" onClick={onEnter}>
            Explore Menu →
          </button>
          <p className="splash__sub">Spice Court · Fresh ingredients. Great food.</p>
        </div>
      </div>
    </div>
  );
}
