import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LanguageProvider } from "./context/LanguageContext";
import { Toaster } from "./components/ui/sonner";
import ScrollToTop from "./components/ScrollToTop";
import Home from "./pages/Home";
import ServicesIndex from "./pages/ServicesIndex";
import ServiceDetail from "./pages/ServiceDetail";
import ProcessPage from "./pages/ProcessPage";
import Resources from "./pages/Resources";
import CertificationsPage from "./pages/CertificationsPage";
import QuotePage from "./pages/QuotePage";
import EstimatePage from "./pages/EstimatePage";
import NotFoundPage from "./pages/NotFoundPage";

/**
 * Rutas de la SPA.
 *
 * Deben coincidir con frontend/src/config/site.json: ese manifiesto es el que
 * usa scripts/build-site.mjs para generar un HTML por ruta. Una ruta que exista
 * aquí y no allí funcionará al navegar dentro de la aplicación, pero devolverá
 * 404 si alguien la abre directamente, porque no existirá como asset.
 */
function App() {
  return (
    <LanguageProvider>
      <div className="App">
        <BrowserRouter>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/servicios" element={<ServicesIndex />} />
            <Route path="/servicios/:slug" element={<ServiceDetail />} />
            <Route path="/proceso" element={<ProcessPage />} />
            <Route path="/recursos" element={<Resources />} />
            <Route path="/certificaciones" element={<CertificationsPage />} />
            <Route path="/cotizar" element={<QuotePage />} />
            <Route path="/estimacion" element={<EstimatePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </div>
    </LanguageProvider>
  );
}

export default App;
