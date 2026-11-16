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
    id: '2026-11-main-liberation-multiplayer',
    date: 'Recent',
    title: 'Latest Updates',
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
    ],
  },
];

export const LATEST_UPDATE_ID = UPDATES[0]?.id ?? '';
