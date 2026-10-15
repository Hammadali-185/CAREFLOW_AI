import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppProviders } from './app/providers';
import { loadWebConfig } from './lib/config';
import './styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root is missing.');
}

try {
  const config = loadWebConfig(import.meta.env);
  createRoot(rootElement).render(
    <StrictMode>
      <AppProviders config={config}>
        <App />
      </AppProviders>
    </StrictMode>,
  );
} catch (error) {
  renderConfigurationError(rootElement, error);
}

function renderConfigurationError(root: HTMLElement, error: unknown) {
  const message = error instanceof Error ? error.message : 'Frontend configuration is invalid.';
  root.replaceChildren();

  const main = document.createElement('main');
  main.style.maxWidth = '42rem';
  main.style.margin = '12vh auto';
  main.style.padding = '0 1.25rem';
  main.style.fontFamily = 'Segoe UI, sans-serif';
  main.style.color = '#1b2421';

  const heading = document.createElement('h1');
  heading.textContent = 'CareFlow AI cannot start';
  heading.style.fontSize = '1.75rem';

  const detail = document.createElement('pre');
  detail.textContent = message;
  detail.style.whiteSpace = 'pre-wrap';
  detail.style.lineHeight = '1.5';

  main.append(heading, detail);
  root.append(main);
}
