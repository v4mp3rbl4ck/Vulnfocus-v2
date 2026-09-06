import React from 'react';

/**
 * Escudo bicolor de VulnFocus. Estaba duplicado literalmente en Header, Footer y
 * Methodology; ahora es un único componente.
 */
const BrandLogo = ({ size = 24, className = 'logo-icon' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M12 2L3 5V11C3 16.55 6.84 21.74 12 23"
      fill="none"
      stroke="#0080FF"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 2L21 5V11C21 16.55 17.16 21.74 12 23"
      fill="none"
      stroke="#FF4458"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default BrandLogo;
