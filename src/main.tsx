// Must stay first: see domainMoveBoot.ts
import { movingAway } from './ui/domainMoveBoot';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { KeywordTooltip } from './ui/components/Keyword';
import { DialogHost } from './ui/components/Dialog';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { applyAutoFit, applyCardSize, savedAutoFit, savedCardSize } from './ui/cardSize';
import { animationsEnabled, applyAnimations } from './ui/animations';
import { installChunkReload } from './ui/chunkReload';
import { diagnoseLoad, installReloadWatch } from './ui/reloadReason';
import { ReloadNotice } from './ui/components/ReloadNotice';
import { hasSavedCustomDecks, requestPersistentStorage } from './data/customDecks';
import './index.css';

// Ask the browser not to clear saved decks when the device is low on space
if (!movingAway && hasSavedCustomDecks()) requestPersistentStorage();

applyCardSize(savedCardSize());
applyAutoFit(savedAutoFit());
applyAnimations(animationsEnabled());
installChunkReload();
const reloadMessage = diagnoseLoad();
installReloadWatch();

if (!movingAway) ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <KeywordTooltip />
    <DialogHost />
    <ReloadNotice message={reloadMessage} />
  </React.StrictMode>
);
