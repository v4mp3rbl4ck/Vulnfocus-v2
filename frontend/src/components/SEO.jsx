import { useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';

/**
 * Componente SEO para actualizar meta tags dinámicamente
 * Uso: <SEO title="Mi Página" description="Descripción" />
 */
const SEO = ({ 
  title, 
  description, 
  keywords,
  image = '/og-image.png',
  url,
  type = 'website'
}) => {
  const { language } = useLanguage();
  
  const baseUrl = 'https://vulnfocus.com';
  const fullUrl = url ? `${baseUrl}${url}` : baseUrl;
  const fullImage = image.startsWith('http') ? image : `${baseUrl}${image}`;
  
  // Títulos y descripciones por defecto según idioma
  const defaults = {
    es: {
      title: 'VulnFocus SPA | Pentesting y Ciberseguridad Profesional',
      description: 'Servicios profesionales de pentesting, ethical hacking y análisis de vulnerabilidades. Protege tu empresa con expertos certificados en ciberseguridad.',
      keywords: 'pentesting, ethical hacking, ciberseguridad, seguridad informática, análisis de vulnerabilidades, Chile'
    },
    en: {
      title: 'VulnFocus SPA | Professional Pentesting & Cybersecurity',
      description: 'Professional pentesting, ethical hacking and vulnerability analysis services. Protect your business with certified cybersecurity experts.',
      keywords: 'pentesting, ethical hacking, cybersecurity, information security, vulnerability analysis, Chile'
    }
  };
  
  const currentDefaults = defaults[language] || defaults.es;
  
  const finalTitle = title || currentDefaults.title;
  const finalDescription = description || currentDefaults.description;
  const finalKeywords = keywords || currentDefaults.keywords;
  
  useEffect(() => {
    // Actualizar título
    document.title = finalTitle;
    
    // Actualizar idioma del documento
    document.documentElement.lang = language;
    
    // Función helper para actualizar meta tags
    const updateMeta = (name, content, isProperty = false) => {
      const attr = isProperty ? 'property' : 'name';
      let element = document.querySelector(`meta[${attr}="${name}"]`);
      if (element) {
        element.setAttribute('content', content);
      } else {
        element = document.createElement('meta');
        element.setAttribute(attr, name);
        element.setAttribute('content', content);
        document.head.appendChild(element);
      }
    };
    
    // Meta tags básicos
    updateMeta('description', finalDescription);
    updateMeta('keywords', finalKeywords);
    
    // Open Graph
    updateMeta('og:title', finalTitle, true);
    updateMeta('og:description', finalDescription, true);
    updateMeta('og:image', fullImage, true);
    updateMeta('og:url', fullUrl, true);
    updateMeta('og:type', type, true);
    updateMeta('og:locale', language === 'es' ? 'es_CL' : 'en_US', true);
    
    // Twitter Card
    updateMeta('twitter:title', finalTitle);
    updateMeta('twitter:description', finalDescription);
    updateMeta('twitter:image', fullImage);
    updateMeta('twitter:url', fullUrl);
    
    // Canonical URL
    let canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      canonical.setAttribute('href', fullUrl);
    }
    
  }, [finalTitle, finalDescription, finalKeywords, fullUrl, fullImage, language, type]);
  
  return null; // Este componente no renderiza nada
};

export default SEO;
