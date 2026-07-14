import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

// Sections live only on the home page ("/"). From any other route these
// must navigate home first, then scroll — a raw <a href="#hash"> or
// window.location.href hack silently does nothing off "/".
const sectionLinks = [
  { label: 'Services', hash: '#services' },
  { label: 'Work', hash: '#work' },
  { label: 'Process', hash: '#process' },
  { label: 'Contact', hash: '#contact' },
];

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';
  const isPortfolio = location.pathname.startsWith('/portfolio');

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 100);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const goToSection = (hash: string) => {
    setMobileOpen(false);
    if (isHome) {
      document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate('/' + hash);
    }
  };

  const goHome = () => {
    setMobileOpen(false);
    if (isHome) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      navigate('/');
    }
  };

  const navLinkClass = (active: boolean) =>
    `font-display font-medium uppercase transition-colors duration-200 ${
      active ? 'text-[#DFE104]' : 'text-[#A1A1AA] hover:text-[#DFE104]'
    }`;

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
            href="/"
            onClick={(e) => {
              e.preventDefault();
              goHome();
            }}
            aria-label="LATech Solutions — home"
          >
            <img
              src="/brand/latech-logo-primary.svg"
              alt="LATech Solutions"
              className="w-auto"
              style={{ height: 'clamp(28px, 2.5vw, 36px)' }}
            />
          </a>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            {sectionLinks.map((link) => (
              <a
                key={link.label}
                href={isHome ? link.hash : '/' + link.hash}
                onClick={(e) => {
                  e.preventDefault();
                  goToSection(link.hash);
                }}
                className={navLinkClass(false)}
                style={{
                  fontSize: 'clamp(0.75rem, 1vw, 1.125rem)',
                  letterSpacing: '-0.02em',
                }}
              >
                {link.label}
              </a>
            ))}
            <Link
              to="/portfolio"
              onClick={() => setMobileOpen(false)}
              aria-current={isPortfolio ? 'page' : undefined}
              className={navLinkClass(isPortfolio)}
              style={{
                fontSize: 'clamp(0.75rem, 1vw, 1.125rem)',
                letterSpacing: '-0.02em',
              }}
            >
              Portfolio
            </Link>
            <Link
              to="/portal"
              className={navLinkClass(false)}
              style={{
                fontSize: 'clamp(0.75rem, 1vw, 1.125rem)',
                letterSpacing: '-0.02em',
              }}
            >
              Portal
            </Link>
            <a
              href={isHome ? '#contact' : '/#contact'}
              onClick={(e) => {
                e.preventDefault();
                goToSection('#contact');
              }}
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
          {sectionLinks.map((link) => (
            <a
              key={link.label}
              href={isHome ? link.hash : '/' + link.hash}
              onClick={(e) => {
                e.preventDefault();
                goToSection(link.hash);
              }}
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
          <Link
            to="/portfolio"
            onClick={() => setMobileOpen(false)}
            aria-current={isPortfolio ? 'page' : undefined}
            className={`font-display font-bold uppercase transition-colors duration-200 ${
              isPortfolio ? 'text-[#DFE104]' : 'text-[#FAFAFA] hover:text-[#DFE104]'
            }`}
            style={{
              fontSize: 'clamp(2.5rem, 8vw, 8rem)',
              lineHeight: 0.85,
              letterSpacing: '-0.02em',
            }}
          >
            Portfolio
          </Link>
          <Link
            to="/portal"
            onClick={() => setMobileOpen(false)}
            className="font-display font-bold uppercase text-[#FAFAFA] hover:text-[#DFE104] transition-colors duration-200"
            style={{
              fontSize: 'clamp(2.5rem, 8vw, 8rem)',
              lineHeight: 0.85,
              letterSpacing: '-0.02em',
            }}
          >
            Portal
          </Link>
          <a
            href={isHome ? '#contact' : '/#contact'}
            onClick={(e) => {
              e.preventDefault();
              goToSection('#contact');
            }}
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
