import { createRoot } from 'react-dom/client';
import './style.css';

const { App } = await (new URLSearchParams(location.search).has('compare') ? import('./comparison-app') : import('./app'));
createRoot(document.getElementById('root')!).render(<App />);
