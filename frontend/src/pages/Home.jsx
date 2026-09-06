import React from 'react';
import Layout from '../components/Layout';
import Hero from '../components/Hero';
import ValueProps from '../components/ValueProps';
import ServicesGrid from '../components/ServicesGrid';
import ScanVsPentest from '../components/ScanVsPentest';
import CtaBand from '../components/CtaBand';
import Contact from '../components/Contact';

const Home = () => (
  <Layout>
    <Hero />
    <ValueProps />
    <ServicesGrid />
    <ScanVsPentest />
    <CtaBand />
    <Contact />
  </Layout>
);

export default Home;
