import { createRoot } from 'react-dom/client'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router'
import './index.css'

// Marketing site and portal are separate audiences that never need each
// other's code — splitting them means a homepage visitor never downloads
// the portal's Radix dialogs/recharts/etc, and vice versa.
const App = lazy(() => import('./App.tsx'))
const PortalApp = lazy(() => import('./portal/PortalApp.tsx'))
// Portfolio is its own chunk: it doesn't need the home page's three.js/GSAP
// payload, and home visitors don't need the full project grid.
const PortfolioPage = lazy(() => import('./pages/PortfolioPage.tsx'))

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Suspense fallback={null}>
      <Routes>
        <Route path="/portal/*" element={<PortalApp />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/*" element={<App />} />
      </Routes>
    </Suspense>
  </BrowserRouter>
)
