import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { AuthProvider, PrefsProvider } from './lib/context';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrefsProvider>
      <AuthProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </AuthProvider>
    </PrefsProvider>
  </StrictMode>,
);
