import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import HelixisPanel from './HelixisPanel';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelixisPanel />
  </StrictMode>
);
