import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { KeywordTooltip } from './ui/components/Keyword';
import { DialogHost } from './ui/components/Dialog';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { applyCardSize, savedCardSize } from './ui/cardSize';
import { installChunkReload } from './ui/chunkReload';
import { diagnoseLoad, installReloadWatch } from './ui/reloadReason';
import { ReloadNotice } from './ui/components/ReloadNotice';
import './index.css';

applyCardSize(savedCardSize());
installChunkReload();
const reloadMessage = diagnoseLoad();
installReloadWatch();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <KeywordTooltip />
    <DialogHost />
    <ReloadNotice message={reloadMessage} />
  </React.StrictMode>
);
