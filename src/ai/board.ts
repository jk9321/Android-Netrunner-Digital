import { CardInstance, GameState, ServerState, cardDef } from '../core';

// Board-only helpers the valuation layer and corp/ both read: a leaf that imports core only (Stage B review R8)

/** The scoring remote: the remote with the most ice that isn't holding a money asset or trap (null with no iced remote). */
export function mainRemote(state: GameState): ServerState | null {
  let best: ServerState | null = null;
  for (const server of Object.values(state.corp.servers))
    if (server.isRemote && server.ice.length > 0 && !server.root.some(c => cardDef(c).type_code === 'asset') && (!best || server.ice.length > best.ice.length)) best = server;
  return best;
}

/** The board with `ice` installed outermost on `server` (a new remote when null), for ice whose strength depends on where it sits (Scatter Field, 4.6.9). Shallow: only the corp's servers are copied. */
export function withIceInstalled(state: GameState, ice: CardInstance, server: ServerState | null): GameState {
  const target: ServerState = server ?? { id: 'remote-placed', name: 'New remote', isRemote: true, ice: [], root: [] };
  return { ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [target.id]: { ...target, ice: [...target.ice, ice] } } } };
}
