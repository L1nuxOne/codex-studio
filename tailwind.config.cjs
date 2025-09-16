const path = require('node:path');

module.exports = {
  darkMode: 'class',
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'src/**/*.{ts,tsx,js,jsx}')
  ],
  theme: {
    extend: {}
  },
  plugins: []
};
