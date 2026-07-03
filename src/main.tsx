import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router'
import './index.css'
import App from './App.tsx'
import PortalApp from './portal/PortalApp.tsx'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/portal/*" element={<PortalApp />} />
      <Route path="/*" element={<App />} />
    </Routes>
  </BrowserRouter>
)
