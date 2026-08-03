import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';

// Order matters: tokens define the custom properties global.scss then consumes.
import './styles/tokens.scss';
import './styles/global.scss';

// Non-null: index.html always ships the #root div, so a miss is a broken build, not a
// runtime case worth branching on.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
