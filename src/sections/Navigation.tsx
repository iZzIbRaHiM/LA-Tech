import { useState, useEffect } from 'react';

const navLinks = [
  { label: 'Services', href: '#services' },
  { label: 'Work', href: '#work' },
  { label: 'Process', href: '#process' },
  { label: 'Contact', href: '#contact' },
];

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 100);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    const el = document.querySelector(href);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
      setMobileOpen(false);
    } else {
      // Section anchors only exist on the home page — from /portfolio (or any
      // other page) route back home with the hash so the section still opens.
      window.location.href = '/' + href;
    }
  };

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          height: '72px',
          backgroundColor: scrolled ? 'rgba(9, 9, 11, 0.85)' : 'transparent',
          backdropFilter: scrolled ? 'blur(8px)' : 'none',
          borderBottom: scrolled ? '1px solid #3F3F46' : '1px solid transparent',
        }}
      >
        <div
          className="flex items-center justify-between h-full"
          style={{ padding: '0 clamp(1.5rem, 5vw, 6rem)' }}
        >
          {/* Logo */}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="font-display font-bold uppercase tracking-tighter text-[#FAFAFA]"
            style={{ fontSize: 'clamp(1.5rem, 4vw, 4rem)', lineHeight: 0.85 }}
          >
            LATech
          </a>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={(e) => handleNavClick(e, link.href)}
                className="font-display font-medium uppercase text-[#A1A1AA] hover:text-[#DFE104] transition-colors duration-200"
                style={{
                  fontSize: 'clamp(0.75rem, 1vw, 1.125rem)',
                  letterSpacing: '-0.02em',
                }}
              >
                {link.label}
              </a>
            ))}
            <a
              href="/portal"
              className="font-display font-medium uppercase text-[#A1A1AA] hover:text-[#DFE104] transition-colors duration-200"
              style={{
                fontSize: 'clamp(0.75rem, 1vw, 1.125rem)',
                letterSpacing: '-0.02em',
              }}
            >
              Portal
            </a>
            <a
              href="#contact"
              onClick={(e) => handleNavClick(e, '#contact')}
              className="font-display font-bold uppercase bg-[#DFE104] text-[#000000] hover:scale-105 active:scale-95 transition-all duration-200"
              style={{
                height: '40px',
                padding: '0 1.5rem',
                fontSize: 'clamp(0.75rem, 1vw, 1.125rem)',
                letterSpacing: '-0.02em',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '0',
              }}
            >
              Start a Project
            </a>
          </div>

          {/* Mobile Hamburger */}
          <button
            className="md:hidden flex flex-col gap-1.5 p-2"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <span
              className="block w-6 bg-[#FAFAFA] transition-all duration-300"
              style={{
                height: '2px',
                transform: mobileOpen ? 'rotate(45deg) translate(4px, 4px)' : 'none',
              }}
            />
            <span
              className="block w-6 bg-[#FAFAFA] transition-all duration-300"
              style={{
                height: '2px',
                opacity: mobileOpen ? 0 : 1,
              }}
            />
            <span
              className="block w-6 bg-[#FAFAFA] transition-all duration-300"
              style={{
                height: '2px',
                transform: mobileOpen ? 'rotate(-45deg) translate(4px, -4px)' : 'none',
              }}
            />
          </button>
        </div>
      </nav>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-[#09090B] flex flex-col items-center justify-center gap-8 md:hidden">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={(e) => handleNavClick(e, link.href)}
              className="font-display font-bold uppercase text-[#FAFAFA] hover:text-[#DFE104] transition-colors duration-200"
              style={{
                fontSize: 'clamp(2.5rem, 8vw, 8rem)',
                lineHeight: 0.85,
                letterSpacing: '-0.02em',
              }}
            >
              {link.label}
            </a>
          ))}
          <a
            href="#contact"
            onClick={(e) => handleNavClick(e, '#contact')}
            className="font-display font-bold uppercase bg-[#DFE104] text-[#000000] mt-4 hover:scale-105 active:scale-95 transition-all duration-200"
            style={{
              height: '56px',
              padding: '0 2rem',
              fontSize: 'clamp(1.125rem, 2vw, 1.5rem)',
              letterSpacing: '-0.02em',
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: '0',
            }}
          >
            Start a Project
          </a>
        </div>
      )}
    </>
  );
}
