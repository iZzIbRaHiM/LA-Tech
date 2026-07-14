// Noise texture overlay shared by the marketing pages (home + portfolio).
export default function NoiseOverlay() {
  return (
    <div
      className="fixed inset-0 pointer-events-none z-[100]"
      style={{
        opacity: 0.03,
        mixBlendMode: 'overlay',
      }}
    >
      <svg width="100%" height="100%">
        <title>Noise texture</title>
        <filter id="noise">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.8"
            numOctaves="4"
            stitchTiles="stitch"
          />
        </filter>
        <rect width="100%" height="100%" filter="url(#noise)" />
      </svg>
    </div>
  );
}
