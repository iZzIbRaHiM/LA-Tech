const stats = [
  { number: '150+', label: 'Projects Delivered' },
  { number: '50+', label: 'Business Partners' },
  { number: '12+', label: 'Years Experience' },
  { number: '24/7', label: 'Support Available' },
];

function StatItem({ number, label }: { number: string; label: string }) {
  return (
    <div className="flex flex-col items-center mx-12 md:mx-20 shrink-0">
      <span
        className="font-display font-bold text-[#000000] uppercase"
        style={{
          fontSize: 'clamp(3rem, 8vw, 7rem)',
          lineHeight: 0.85,
          letterSpacing: '-0.02em',
        }}
      >
        {number}
      </span>
      <span
        className="font-display font-medium text-[#000000] uppercase mt-2"
        style={{
          fontSize: 'clamp(0.75rem, 1vw, 1rem)',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </span>
    </div>
  );
}

export default function StatsMarquee() {
  const content = (
    <>
      {stats.map((stat, i) => (
        <div key={i} className="flex items-center">
          <StatItem number={stat.number} label={stat.label} />
          <span
            className="text-[#000000] mx-8 md:mx-12 shrink-0"
            style={{ opacity: 0.4, fontSize: 'clamp(0.75rem, 1vw, 1rem)' }}
          >
            ★
          </span>
        </div>
      ))}
    </>
  );

  return (
    <section
      className="w-full overflow-hidden bg-[#DFE104] flex items-center"
      style={{ height: 'clamp(100px, 12vw, 160px)' }}
    >
      <div className="flex animate-marquee whitespace-nowrap">
        {content}
        {content}
      </div>
    </section>
  );
}
