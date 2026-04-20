export default function HeroHeader() {
  return (
    <header style={{ position: 'relative', overflow: 'hidden', background: '#ffffff', borderBottom: '1px solid #e0e0e0' }}>
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.1, pointerEvents: 'none' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="court" width="140" height="140" patternUnits="userSpaceOnUse">
            <rect width="140" height="140" fill="none" stroke="#4CAF50" strokeWidth="1.5" />
            <line x1="70" y1="0" x2="70" y2="140" stroke="#4CAF50" strokeWidth="1" />
            <line x1="0" y1="46" x2="140" y2="46" stroke="#4CAF50" strokeWidth="1" />
            <line x1="0" y1="94" x2="140" y2="94" stroke="#4CAF50" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#court)" />
      </svg>

      <div style={{ position: 'relative', maxWidth: '80rem', margin: '0 auto', padding: '3.7rem 1.5rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1 }}>
          <span style={{ color: '#1a1a1a' }}>WHEN </span>
          <span style={{ color: '#4CAF50' }}>BADDY?</span>
        </h1>
        <p style={{ marginTop: '1rem', fontSize: '0.85rem', letterSpacing: '0.25em', textTransform: 'uppercase', color: '#777777', fontWeight: 500, whiteSpace: 'nowrap', margin: '1rem auto 0' }}>
          Find available badminton courts near you
        </p>
      </div>

      <div style={{ height: '3px', width: '100%', background: '#4CAF50' }} />
    </header>
  )
}
