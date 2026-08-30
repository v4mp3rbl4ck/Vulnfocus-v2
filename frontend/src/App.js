import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LanguageProvider } from "./context/LanguageContext";
import { Toaster } from "./components/ui/sonner";
import Home from "./pages/Home";
import Resources from "./pages/Resources";
import ProcessPage from "./pages/ProcessPage";
import CertificationsPage from "./pages/CertificationsPage";

function App() {
  return (
    <LanguageProvider>
      <div className="App">
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/recursos" element={<Resources />} />
            <Route path="/proceso" element={<ProcessPage />} />
            <Route path="/certificaciones" element={<CertificationsPage />} />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </div>
    </LanguageProvider>
  );
}

export default App;
