import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServerColumn } from '../src/ui/components/ServerColumn';
import { hoverPromptServer, hoverPromptTarget } from '../src/ui/promptHighlight';
import { newGame } from './helpers';

describe('Server highlight', () => {
  beforeEach(() => {
    hoverPromptServer(null);
    hoverPromptTarget(null);
  });

  it('renders ServerColumn with prompt-server-target when server is hovered', () => {
    const s = newGame();
    const hqServer = s.corp.servers['hq'];
    const rdServer = s.corp.servers['rd'];

    // Before hover: standard border
    const beforeHtml = renderToStaticMarkup(
      <ServerColumn server={hqServer} activePlayer="corp" />
    );
    expect(beforeHtml).not.toContain('prompt-server-target');
    expect(beforeHtml).not.toContain('data-server-highlighted');

    // Hover HQ server
    hoverPromptServer('hq');
    const hoveredHtml = renderToStaticMarkup(
      <ServerColumn server={hqServer} activePlayer="corp" />
    );
    expect(hoveredHtml).toContain('prompt-server-target');
    expect(hoveredHtml).toContain('data-server-highlighted="true"');

    // Other servers (e.g. R&D) are not highlighted
    const rdHtml = renderToStaticMarkup(
      <ServerColumn server={rdServer} activePlayer="corp" />
    );
    expect(rdHtml).not.toContain('prompt-server-target');
    expect(rdHtml).not.toContain('data-server-highlighted');

    // Switch hover to R&D
    hoverPromptServer('rd');
    const rdAfterHtml = renderToStaticMarkup(
      <ServerColumn server={rdServer} activePlayer="corp" />
    );
    expect(rdAfterHtml).toContain('prompt-server-target');
    expect(rdAfterHtml).toContain('data-server-highlighted="true"');

    // HQ should no longer be highlighted
    const hqAfterHtml = renderToStaticMarkup(
      <ServerColumn server={hqServer} activePlayer="corp" />
    );
    expect(hqAfterHtml).not.toContain('prompt-server-target');
    expect(hqAfterHtml).not.toContain('data-server-highlighted');

    // Unhover clears highlight completely
    hoverPromptServer(null);
    const clearedHtml = renderToStaticMarkup(
      <ServerColumn server={hqServer} activePlayer="corp" />
    );
    expect(clearedHtml).not.toContain('prompt-server-target');
    expect(clearedHtml).not.toContain('data-server-highlighted');
  });
});
