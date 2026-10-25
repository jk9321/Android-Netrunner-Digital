import { Plus } from 'lucide-react';
import { CardInstance, GameAction, GameState, cardDef, getLegalActions } from '../../core';

/**
 * Where the selected HQ card can go: a new remote, or any server the engine
 * allows (ice on any server, upgrades in centrals, a replacement in a remote).
 */
export function CorpInstallOptions({
  state,
  card,
  onAction,
}: {
  state: GameState;
  card: CardInstance;
  onAction: (action: GameAction) => void;
}) {
  const def = cardDef(card);
  const options = getLegalActions(state, 'corp').filter(
    (a): a is Extract<GameAction, { type: 'INSTALL_CARD' }> => a.type === 'INSTALL_CARD' && a.cardInstanceId === card.instanceId
  );
  if (options.length === 0) {
    return <span className="text-xs text-slate-400">{def.title} cannot be installed right now.</span>;
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="install-options">
      <span className="text-xs text-amber-300 font-bold">Install {def.title}:</span>
      {options.map(a => {
        const server = a.targetServerId ? state.corp.servers[a.targetServerId] : null;
        const iceCost = def.type_code === 'ice' && server ? server.ice.length : 0;
        const replaced =
          server && ['agenda', 'asset'].includes(def.type_code)
            ? server.root.find(c => ['agenda', 'asset'].includes(cardDef(c).type_code))
            : undefined;
        return (
          <button
            key={`${a.targetServerId ?? 'new'}${a.faceUp ? '-faceup' : ''}`}
            onClick={() => onAction(a)}
            data-testid={`install-${a.targetServerId ?? 'new'}${a.faceUp ? '-faceup' : ''}`}
            title={replaced ? `Trashes ${cardDef(replaced).title} to make room` : undefined}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl transition-all flex items-center gap-1 shadow-lg"
          >
            <Plus className="w-3.5 h-3.5" /> {server ? server.name : 'New remote'}
            {iceCost > 0 && ` (${iceCost}c)`}
            {replaced && ' (replace)'}
            {a.faceUp && ' (faceup)'}
          </button>
        );
      })}
    </div>
  );
}
