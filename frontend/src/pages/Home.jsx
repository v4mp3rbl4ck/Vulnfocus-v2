import React from 'react';
import SEO from '../components/SEO';
import Header from '../components/Header';
import Hero from '../components/Hero';
import Services from '../components/Services';
import Methodology from '../components/Methodology';
import Contact from '../components/Contact';
import Footer from '../components/Footer';

const Home = () => {
  return (
    <div className="app-wrapper">
      <SEO 
        url="/"
        // Usa los valores por defecto del componente SEO
      />
      <Header />
      <main>
        <Hero />
        <Services />
        <Methodology />
        <Contact />
      </main>
      <Footer />
    </div>
  );
};

export default Home;
