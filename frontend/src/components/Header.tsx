export default function Header() {
  return (
    <header className="hero-header">
      <div className="hero-header-grid" aria-hidden="true" />
      <div className="hero-header-orb hero-header-orb-left" aria-hidden="true" />
      <div className="hero-header-orb hero-header-orb-right" aria-hidden="true" />

      <div className="hero-header-inner">
        <h1 className="hero-header-title">
          <span className="hero-header-title-main">WHEN</span>{' '}
          <span className="hero-header-title-accent">BADDY?</span>
        </h1>
        <p className="hero-header-subtitle">FIND AVAILABLE BADMINTON COURTS NEAR YOU</p>
      </div>

      <svg
        className="hero-header-wave"
        viewBox="0 0 1440 120"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M0,76 C220,96 430,56 720,74 C1010,92 1220,58 1440,76 L1440,120 L0,120 Z" />
      </svg>
    </header>
  )
}
