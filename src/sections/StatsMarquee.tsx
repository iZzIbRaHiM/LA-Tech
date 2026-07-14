const stats = [
  { number: '2+', label: 'Years Experience' },
  { number: '100+', label: 'Business Clients' },
  { number: '14+', label: 'Products Delivered' },
  { number: '24/7', label: 'Support Available' },
];

function StatItem({ number, label }: { number: string; label: string }) {
  return (
    <div className="flex flex-col items-center mx-12 md:mx-20 shrink-0">
      <span
        className="font-display font-bold text-[#000000] uppercase"
        style={{
          fontSize: 'clamp(2.25rem, 5vw, 4.5rem)',
          lineHeight: 0.9,
          letterSpacing: '-0.02em',
        }}
      >
        {number}
      </span>
      <span
        className="font-display font-medium text-[#000000] uppercase mt-3"
        style={{
          fontSize: 'clamp(0.75rem, 1vw, 1rem)',
          letterSpacing: '0.12em',
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
      style={{ height: 'clamp(96px, 10vw, 140px)' }}
    >
      <div className="flex animate-marquee whitespace-nowrap">
        {content}
        {content}
      </div>
    </section>
  );
}
