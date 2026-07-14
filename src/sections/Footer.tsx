import { Link, useLocation, useNavigate } from 'react-router';

const serviceLinks = [
  'Custom Software',
  'Process Automation',
  'Digital Transformation',
  'Enterprise Solutions',
  'SaaS Development',
  'IT Support',
];

// About Us / Blog / Careers and social profiles are omitted rather than
// linked to "#" placeholders — add them back once real destinations exist.
const companyLinks: { label: string; hash?: string; to?: string }[] = [
  { label: 'Case Studies', to: '/portfolio' },
  { label: 'Contact', hash: '#contact' },
];

const connectLinks = [{ label: 'Email', href: 'mailto:hello@latechs.org' }];

export default function Footer() {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';

  const goToSection = (hash: string) => {
    if (isHome) {
      document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate('/' + hash);
    }
  };

  const linkStyle = "text-[#FAFAFA] hover:text-[#DFE104] transition-colors duration-200 block";
  const linkSize = {
    fontSize: 'clamp(1rem, 1.2vw, 1.25rem)',
    fontWeight: 400,
    lineHeight: 2,
  } as React.CSSProperties;

  const headingStyle = "font-display font-bold uppercase text-[#A1A1AA] block mb-4";
  const headingSize = {
    fontSize: 'clamp(0.75rem, 1vw, 1rem)',
    letterSpacing: '0.12em',
  } as React.CSSProperties;

  return (
    <footer className="bg-[#09090B] border-t-2 border-[#3F3F46]">
      {/* Main Footer */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
        style={{
          padding: 'clamp(3rem, 5vw, 5rem) clamp(1.5rem, 5vw, 6rem)',
          gap: '3rem',
        }}
      >
        {/* Brand Column */}
        <div>
          <img
            src="/brand/latech-logo-primary.svg"
            alt="LATech Solutions"
            className="w-auto block"
            style={{ height: 'clamp(36px, 3.5vw, 48px)' }}
          />
          <span
            className="text-[#A1A1AA] block mt-4"
            style={{
              fontSize: 'clamp(0.75rem, 1vw, 1.125rem)',
              fontWeight: 400,
            }}
          >
            B2B Software &amp; IT Solutions
          </span>
        </div>

        {/* Services Column */}
        <div>
          <span className={headingStyle} style={headingSize}>Services</span>
          {serviceLinks.map((link) => (
            <a
              key={link}
              href={isHome ? '#services' : '/#services'}
              onClick={(e) => {
                e.preventDefault();
                goToSection('#services');
              }}
              className={linkStyle}
              style={linkSize}
            >
              {link}
            </a>
          ))}
        </div>

        {/* Company Column */}
        <div>
          <span className={headingStyle} style={headingSize}>Company</span>
          {companyLinks.map((link) =>
            link.to ? (
              <Link key={link.label} to={link.to} className={linkStyle} style={linkSize}>
                {link.label}
              </Link>
            ) : (
              <a
                key={link.label}
                href={isHome ? link.hash : '/' + link.hash}
                onClick={(e) => {
                  e.preventDefault();
                  goToSection(link.hash!);
                }}
                className={linkStyle}
                style={linkSize}
              >
                {link.label}
              </a>
            )
          )}
        </div>

        {/* Connect Column */}
        <div>
          <span className={headingStyle} style={headingSize}>Connect</span>
          {connectLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={linkStyle}
              style={linkSize}
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>

      {/* Bottom Bar */}
      <div
        className="flex items-center justify-center border-t border-[#3F3F46]"
        style={{
          height: 'auto',
          minHeight: '64px',
          padding: '1.5rem clamp(1.5rem, 5vw, 6rem)',
        }}
      >
        <span
          className="text-[#A1A1AA]"
          style={{
            fontSize: 'clamp(0.75rem, 1vw, 1.125rem)',
            fontWeight: 400,
          }}
        >
          &copy; {new Date().getFullYear()} LATech Solutions. All rights reserved.
        </span>
      </div>
    </footer>
  );
}
