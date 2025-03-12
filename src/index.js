// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import reportWebVitals from './reportWebVitals';

// Create a root.
const container = document.getElementById('root');
const root = ReactDOM.createRoot(container);

// Render your app using createRoot.
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
