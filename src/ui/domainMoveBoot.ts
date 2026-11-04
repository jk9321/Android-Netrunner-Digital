import { importHandoff, redirectFromOldHost } from './domainMove';

/**
 * Runs the domain move as main.tsx's first import, so it happens before any
 * other module can read localStorage while loading. The old workers.dev
 * address only forwards to stackheap.run, carrying this browser's saved data.
 */
export const movingAway = redirectFromOldHost();
if (!movingAway) importHandoff();
