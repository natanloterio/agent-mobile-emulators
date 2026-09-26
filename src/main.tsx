// Estilos globais primeiro: a ordem de import define a ordem de injeção do CSS no Vite,
// e as primitivas precisam vir ANTES do CSS de cada tela para que a tela possa sobrescrevê-las.
import './styles/tokens.css';
import './styles/base.css';
import './styles/primitives.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n/I18nProvider';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado no index.html');

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
