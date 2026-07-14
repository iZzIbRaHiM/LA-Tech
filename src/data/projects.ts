// Single source of truth for portfolio projects — consumed by the home
// "Our Work" carousel (featured only) and the /portfolio page (all).
// Adding a project = one entry here + one 16:9 image in public/images/portfolio/.

export type ProjectCategory = 'platform' | 'web3' | 'web' | 'mobile' | 'opensource';

export const CATEGORY_LABELS: Record<ProjectCategory, string> = {
  platform: 'Enterprise & SaaS',
  web3: 'Blockchain & Web3',
  web: 'Websites & E-Commerce',
  mobile: 'Mobile Apps',
  opensource: 'R&D & Open Source',
};

export interface Project {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: ProjectCategory;
  tech: string[];
  image: string;
  liveUrl?: string;
  githubUrl?: string;
  storeUrl?: string;
  featured?: boolean;
}

export const projects: Project[] = [
  {
    slug: 'construction-erp',
    name: 'Construction Management ERP',
    tagline: 'End-to-end ERP for construction firms — projects, procurement, payroll.',
    description:
      'A full enterprise resource planning system built for the construction industry: project costing, site progress tracking, procurement, inventory, and payroll in one integrated platform with role-based access for management, site engineers, and accounts.',
    category: 'platform',
    tech: ['React', 'Node.js', 'PostgreSQL', 'TypeScript'],
    image: '/images/portfolio/construction-erp.svg',
    featured: true,
  },
  {
    slug: 'atlas',
    name: 'Atlas',
    tagline: 'AI validation intelligence for startup ideas — with sources.',
    description:
      'A two-module AI SaaS platform: describe a startup idea and Atlas mines Reddit, Hacker News, GitHub, and the web into an evidence-linked validation report — opportunity score, pain-point clusters, competitor intel, and willingness-to-pay signals, every claim linked to its source. A second module curates a community-rated library of real UI-generation prompts.',
    category: 'platform',
    tech: ['Next.js 15', 'FastAPI', 'Supabase pgvector', 'Inngest', 'Stripe'],
    image: '/images/portfolio/atlas.png',
    featured: true,
  },
  {
    slug: 'guestpostbar',
    name: 'Guestpostbar',
    tagline: 'Transparent guest-posting marketplace with localized pricing.',
    description:
      'A marketplace where users compare publisher rates across 2,500+ domains, contact publishers directly, and see pricing auto-localized to their country and currency — bringing transparency to an opaque industry.',
    category: 'platform',
    tech: ['React', 'Node.js', 'REST API', 'Currency Localization'],
    image: '/images/portfolio/guestpostbar.png',
    liveUrl: 'https://guestpostbar.com/',
    featured: true,
  },
  {
    slug: 'school-portal',
    name: 'School Management Portal',
    tagline: 'All-in-one portal for admins, teachers, students, and parents.',
    description:
      'A unified school management system covering attendance, grades, fee management, and instant SMS alerts to parents — with role-scoped dashboards for every stakeholder. Live demo available on request.',
    category: 'platform',
    tech: ['React', 'Node.js', 'PostgreSQL', 'SMS Integration'],
    image: '/images/portfolio/school-portal.png',
    liveUrl: 'https://school-portal-virid-one.vercel.app/login',
  },
  {
    slug: 'gainblockx',
    name: 'GainBlockX',
    tagline: 'Decentralized referral & rewards platform on BNB Smart Chain.',
    description:
      'A decentralized platform on BNB Smart Chain where every draw, ticket, and payout is verifiable on-chain — wallet-connected participation with a trustworthy, transparent reward system and community referral growth.',
    category: 'web3',
    tech: ['Solidity', 'BNB Smart Chain', 'Web3.js', 'React'],
    image: '/images/portfolio/gainblockx.png',
    liveUrl: 'https://gainblockx.com/',
    featured: true,
  },
  {
    slug: 'golden-vest',
    name: 'Golden Vest',
    tagline: 'Flutter app for tracking community participation & rewards.',
    description:
      'A cross-platform mobile app for a community-driven ecosystem: members track structured participation, performance rewards, and growth analytics from their phone. Published on Google Play.',
    category: 'mobile',
    tech: ['Flutter', 'Dart', 'REST API'],
    image: '/images/portfolio/golden-vest.svg',
    storeUrl: 'https://play.google.com/store/apps/details?id=gol_vest.com',
    featured: true,
  },
  {
    slug: 'grags',
    name: 'Grags',
    tagline: 'Premium menswear e-commerce with a fashion-editorial feel.',
    description:
      'A full e-commerce experience for a menswear brand — seasonal drops, curated collections, and a clean editorial storefront with cart, checkout, and order tracking built for conversion.',
    category: 'web',
    tech: ['React', 'E-Commerce', 'Payments'],
    image: '/images/portfolio/grags.png',
    liveUrl: 'https://grags.shop/',
    featured: true,
  },
  {
    slug: 'bigrafeal',
    name: 'Big Rafeal',
    tagline: 'On-chain raffle platform with automated, auditable payouts.',
    description:
      'A multi-level marketing DApp where reward and referral distribution runs entirely through smart contracts — automated, transparent, and auditable by every participant.',
    category: 'web3',
    tech: ['Solidity', 'Smart Contracts', 'Web3.js', 'React'],
    image: '/images/portfolio/bigrafeal.png',
    liveUrl: 'https://bigrafeal.com/',
  },
  {
    slug: 'inteleum-trade',
    name: 'Inteleum Trade',
    tagline: 'Trustless, wallet-connected on-chain asset trading.',
    description:
      'A fully decentralized Web3 trading platform: users connect a wallet and trade assets trustlessly on-chain through a fast, intuitive interface — no custodian, no middleman.',
    category: 'web3',
    tech: ['Solidity', 'Ethers.js', 'React', 'MetaMask'],
    image: '/images/portfolio/inteleum-trade.svg',
    githubUrl: 'https://github.com/Shahroz-Hussain-Dev/inteleum-trade1/',
  },
  {
    slug: 'assetguard',
    name: 'AssetGuard',
    tagline: 'IPFS asset storage secured by Ethereum smart contracts.',
    description:
      'An immutable digital-ownership system: assets live on IPFS while Ethereum smart contracts anchor ownership and access rights — tamper-proof custody without a central authority.',
    category: 'web3',
    tech: ['Solidity', 'IPFS', 'Ethereum', 'Hardhat'],
    image: '/images/portfolio/assetguard.svg',
    githubUrl: 'https://github.com/Shahroz-Hussain-Dev/Asset-gaurd',
  },
  {
    slug: 'tz-wellness',
    name: 'TZ Wellness Centre',
    tagline: 'Lifestyle-medicine clinic site with online booking.',
    description:
      'A calm, conversion-focused website for a lifestyle-medicine practice — services, practitioner profiles, events, and appointment booking for patients managing chronic and metabolic conditions.',
    category: 'web',
    tech: ['React', 'Booking Integration', 'SEO'],
    image: '/images/portfolio/tz-wellness.png',
    liveUrl: 'https://tzwellnesscentre.com/',
  },
  {
    slug: 'drd-academy',
    name: 'DRD Academy',
    tagline: 'Trading-education platform for a forex institute.',
    description:
      'A branded education platform for a forex market institute: program showcases, enrollment funnels, broker integration links, and WhatsApp support — built to turn visitors into enrolled students.',
    category: 'web',
    tech: ['React', 'Enrollment Funnels', 'WhatsApp API'],
    image: '/images/portfolio/drd-academy.png',
    liveUrl: 'https://drdacademyofficial.com/',
  },
  {
    slug: 'alfazal-palace',
    name: 'Al Fazal Palace Marquee',
    tagline: 'Elegant venue site with gallery and event booking.',
    description:
      'A premium events-venue website with an editorial aesthetic — gallery, services, and direct event-booking flows for one of the region\'s signature celebration venues.',
    category: 'web',
    tech: ['React', 'Gallery', 'Booking'],
    image: '/images/portfolio/alfazal-palace.png',
    liveUrl: 'https://alfazalpalacemarquee.com/',
  },
  {
    slug: 'pychain',
    name: 'PyChain',
    tagline: 'A proof-of-work blockchain built from scratch in Python.',
    description:
      'An in-house R&D build: a working blockchain with proof-of-work consensus, block validation, and peer-to-peer transaction flow — the kind of first-principles engineering that underpins our Web3 client work.',
    category: 'opensource',
    tech: ['Python', 'P2P Networking', 'Cryptography'],
    image: '/images/portfolio/pychain.svg',
    githubUrl: 'https://github.com/Shahroz-Hussain-Dev/pychain',
  },
];

export const featuredProjects = projects.filter((p) => p.featured);
