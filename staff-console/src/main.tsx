import '@fontsource/cairo/arabic-400.css';
import '@fontsource/cairo/arabic-700.css';
import '@fontsource/cairo/latin-400.css';
import '@fontsource/cairo/latin-700.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setLang } from './i18n';

const nav = (navigator.language || 'en').slice(0, 2);
setLang(nav === 'ar' ? 'ar' : nav === 'fr' ? 'fr' : 'en');   // start in the browser language when it is one of the three
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
