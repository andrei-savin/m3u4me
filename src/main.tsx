import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import App from './App.tsx';
import './index.css';
import {initRipples} from './utils/ripple.ts';
import {useStore} from './store.ts';
import {applyMaterialTheme} from './utils/materialTheme.ts';

initRipples();

// Colours and font before the first paint, so the page never flashes the wrong ones. The saved
// settings are already loaded (the store reads localStorage as it's created); App.tsx keeps
// both up to date when they change.
const {accentColor, colorStyle, fontFamily} = useStore.getState();
applyMaterialTheme(accentColor, colorStyle);
document.documentElement.dataset.font = fontFamily;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
