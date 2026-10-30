import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { KeywordTooltip } from './ui/components/Keyword';
import { DialogHost } from './ui/components/Dialog';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { applyCardSize, savedCardSize } from './ui/cardSize';
import { applyComfort, savedComfort } from './ui/comfort';
import { installChunkReload } from './ui/chunkReload';
import './index.css';

applyCardSize(savedCardSize());
applyComfort(savedComfort());
installChunkReload();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <KeywordTooltip />
    <DialogHost />
  </React.StrictMode>
);
