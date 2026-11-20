export interface UpdateLink {
  label: string;
  url: string;
}

export interface UpdateItem {
  text: string;
  link?: UpdateLink;
}

export interface UpdateEntry {
  id: string;
  date: string;
  title: string;
  items: UpdateItem[];
}

/**
 * Recent changes shown in the "What's new" modal on the start screen.
 * Prepend new entries at the top; the first entry's `id` controls the unread badge.
 */
export const UPDATES: UpdateEntry[] = [
  {
    id: '2026-11-20-corp-ai-rules-ui',
    date: 'November 20, 2026',
    title: 'Stronger Corp AI and rules fixes',
    items: [
      { text: 'The Corp AI plays stronger: better rez, scoring, ice placement and money decisions' },
      { text: 'Rules fixes: the run continues correctly when ice leaves the server mid-run, and programs can trash others to make room when installed by a card effect' },
      { text: 'Click board cards and servers to pick prompt and install targets' },
      { text: 'Desktop: the run panel and board prompts dock in the sidebar' },
      { text: 'Score counters in the header open each side\'s score area' },
      { text: 'Deck picker: search decks by title or identity' },
    ],
  },
  {
    id: '2026-11-main-liberation-multiplayer',
    date: 'November 16, 2026',
    title: 'Previous Updates',
    items: [
      {
        text: 'Added Online Multiplayer',
      },
      {
        text: 'Added the Liberation Cycle Sets',
      },
      {
        text: 'Removed pre-loaded decks. Previously preloaded decks can be found at',
        link: {
          label: 'https://nullsignal.games/players/getting-started-sample-decklists/',
          url: 'https://nullsignal.games/players/getting-started-sample-decklists/',
        },
      },
      {
        text: 'Removed hard AI mode for tuning',
      },
    ],
  },
];

export const LATEST_UPDATE_ID = UPDATES[0]?.id ?? '';
