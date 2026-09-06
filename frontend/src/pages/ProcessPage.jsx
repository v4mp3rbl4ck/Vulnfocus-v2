import React from 'react';
import Layout from '../components/Layout';
import Process from '../components/Process';
import ScanVsPentest from '../components/ScanVsPentest';
import CtaBand from '../components/CtaBand';

const ProcessPage = () => (
  <Layout>
    <Process />
    <ScanVsPentest />
    <CtaBand />
  </Layout>
);

export default ProcessPage;
