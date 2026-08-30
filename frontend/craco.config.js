// craco.config.js
// Se mantiene CRA + CRACO deliberadamente: el objetivo de esta migración es eliminar
// la VPS, no modernizar el frontend. La única razón de existir de CRACO aquí es el
// alias "@" -> src/ que usan App.js e index.js.
const path = require("path");

module.exports = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
};
