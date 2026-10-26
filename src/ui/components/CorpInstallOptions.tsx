import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { CardInstance, GameAction, GameState, cardDef, getLegalActions, isLegalAction } from '../../core';

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
  // Ice: trash ice already on a server first, so it doesn't count toward the install cost (rules 8.5.6b)
  const [replacing, setReplacing] = useState<{ cardId: string; serverId: string; trash: string[] } | null>(null);
  const replace = replacing?.cardId === card.instanceId ? replacing : null;
  const installWithTrash = (serverId: string, trashIceIds: string[]): GameAction => ({
    type: 'INSTALL_CARD',
    player: 'corp',
    cardInstanceId: card.instanceId,
    targetServerId: serverId,
    trashIceIds,
  });
  const replaceable =
    def.type_code === 'ice'
      ? Object.values(state.corp.servers).filter(
          s => s.ice.length > 0 && isLegalAction(state, installWithTrash(s.id, s.ice.map(c => c.instanceId)))
        )
      : [];
  if (replace) {
    const server = state.corp.servers[replace.serverId];
    const action = installWithTrash(replace.serverId, replace.trash);
    const cost = Math.max(0, server.ice.length - replace.trash.length);
    const toggle = (id: string) =>
      setReplacing({ ...replace, trash: replace.trash.includes(id) ? replace.trash.filter(t => t !== id) : [...replace.trash, id] });
    return (
      <div className="flex items-center gap-1.5 flex-wrap" data-testid="install-trash-ice">
        <span className="text-xs text-amber-300 font-bold">Trash ice on {server.name} first:</span>
        {[...server.ice].reverse().map(ice => {
          const picked = replace.trash.includes(ice.instanceId);
          return (
            <button
              key={ice.instanceId}
              onClick={() => toggle(ice.instanceId)}
              data-testid={`trash-ice-${ice.instanceId}`}
              className={`px-2.5 py-1 text-xs font-bold rounded-xl border transition-all ${
                picked ? 'bg-red-600 border-red-400 text-white line-through' : 'bg-slate-800 border-slate-600 text-slate-200 hover:border-red-400'
              }`}
            >
              {cardDef(ice).title}
              {!ice.isRezzed && ' (unrezzed)'}
            </button>
          );
        })}
        <button
          onClick={() => {
            setReplacing(null);
            onAction(action);
          }}
          disabled={!isLegalAction(state, action)}
          data-testid="install-trash-confirm"
          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-black text-xs font-bold rounded-xl transition-all flex items-center gap-1 shadow-lg"
        >
          <Plus className="w-3.5 h-3.5" /> Install {def.title}
          {cost > 0 && ` (${cost}c)`}
          {replace.trash.length > 0 && `, trash ${replace.trash.length}`}
        </button>
        <button onClick={() => setReplacing(null)} className="px-2 py-1 text-xs text-slate-400 hover:text-white">
          Cancel
        </button>
      </div>
    );
  }
  const options = getLegalActions(state, 'corp').filter(
    (a): a is Extract<GameAction, { type: 'INSTALL_CARD' }> => a.type === 'INSTALL_CARD' && a.cardInstanceId === card.instanceId
  );
  if (options.length === 0 && replaceable.length === 0) {
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
      {replaceable.map(server => (
        <button
          key={`trash-${server.id}`}
          onClick={() => setReplacing({ cardId: card.instanceId, serverId: server.id, trash: [] })}
          data-testid={`install-replace-${server.id}`}
          title={`Trash ice protecting ${server.name} first; trashed ice doesn't count toward the install cost`}
          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-amber-500/50 text-amber-300 text-xs font-bold rounded-xl transition-all flex items-center gap-1"
        >
          <Trash2 className="w-3.5 h-3.5" /> {server.name}: trash ice first
        </button>
      ))}
    </div>
  );
}
