import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { CardInstance, GameAction, GameState, cardDef, trashableFirst } from '../../core';
import { legalFor, useSeat } from '../seat';
import { TrashFirstPicker, TrashSplitSegment } from './TrashFirstPicker';
import { hoverPromptServer, hoverPromptTarget } from '../promptHighlight';

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
  const seat = useSeat();
  // Clear any hovered target/server when this options bar closes or card changes
  useEffect(() => () => {
    hoverPromptServer(null);
    hoverPromptTarget(null);
  }, [card.instanceId]);

  // Trash cards already there first (rules 8.5.6): ice for ice (they then don't count toward its cost), root cards for a root install
  const [replacing, setReplacing] = useState<{ cardId: string; serverId: string } | null>(null);
  const installWithTrash = (serverId: string, trashFirst: string[]): GameAction => ({
    type: 'INSTALL_CARD',
    player: 'corp',
    cardInstanceId: card.instanceId,
    targetServerId: serverId,
    trashFirst,
  });
  const replaceable = Object.values(state.corp.servers).filter(s => {
    const cards = trashableFirst(state, card, s.id);
    return cards.length > 0 && seat.can(installWithTrash(s.id, cards.map(c => c.instanceId)));
  });
  const replaceableIds = new Set(replaceable.map(s => s.id));
  const what = def.type_code === 'ice' ? 'ice' : 'cards';
  if (replacing?.cardId === card.instanceId) {
    const server = state.corp.servers[replacing.serverId];
    // Outermost ice first, as on the board
    const cards = trashableFirst(state, card, server.id);
    const orderedCards = def.type_code === 'ice' ? [...cards].reverse() : cards;
    return (
      <TrashFirstPicker
        key={`${card.instanceId}-${server.id}`}
        serverId={server.id}
        iceSlots={def.type_code === 'ice'}
        heading={`Install ${def.title} in ${server.name}, trashing first:`}
        cards={orderedCards}
        statusText={
          def.type_code === 'ice'
            ? trash => {
                const orig = server.ice.length;
                const cost = Math.max(0, orig - trash.length);
                return trash.length > 0 ? `Cost: ${cost}c (was ${orig}c)` : `Cost: ${orig}c`;
              }
            : undefined
        }
        confirmLabel={trash => {
          const cost = def.type_code === 'ice' ? Math.max(0, server.ice.length - trash.length) : 0;
          return `Install${cost > 0 ? ` (${cost}c)` : ''}${trash.length > 0 ? `, trash ${trash.length}` : ''}`;
        }}
        canConfirm={trash => seat.can(installWithTrash(server.id, trash))}
        onConfirm={trash => {
          hoverPromptServer(null);
          setReplacing(null);
          onAction(installWithTrash(server.id, trash));
        }}
        onCancel={() => {
          hoverPromptServer(null);
          setReplacing(null);
        }}
      />
    );
  }
  const options = legalFor(seat, 'corp').filter(
    (a): a is Extract<GameAction, { type: 'INSTALL_CARD' }> => a.type === 'INSTALL_CARD' && a.cardInstanceId === card.instanceId
  );
  // Servers that can only be installed into after trashing first (e.g., too expensive without trashing ice)
  const trashOnlyServers = replaceable.filter(s => !options.some(a => a.targetServerId === s.id));

  if (options.length === 0 && replaceable.length === 0) {
    return <span className="text-xs text-slate-400">{def.title} cannot be installed right now.</span>;
  }

  const trashTitle = (serverName: string) =>
    def.type_code === 'ice'
      ? `Trash ice protecting ${serverName} first; trashed ice doesn't count toward the install cost`
      : `Trash cards in the root of ${serverName} first`;

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
        const canTrashSplit = !!server && !a.faceUp && replaceableIds.has(server.id);

        const handleMouseEnter = () => {
          if (server) {
            hoverPromptServer(server.id);
          }
          if (replaced) {
            hoverPromptTarget({ id: replaced.instanceId, label: 'replace' });
          }
        };

        const handleMouseLeave = () => {
          hoverPromptServer(null);
          if (replaced) {
            hoverPromptTarget(null);
          }
        };

        const handleClick = () => {
          hoverPromptServer(null);
          if (replaced) {
            hoverPromptTarget(null);
          }
          onAction(a);
        };

        const mainBtn = (
          <button
            key={`${a.targetServerId ?? 'new'}${a.faceUp ? '-faceup' : ''}`}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            data-testid={`install-${a.targetServerId ?? 'new'}${a.faceUp ? '-faceup' : ''}`}
            title={replaced ? `Trashes ${cardDef(replaced).title} to make room` : undefined}
            className={`px-3 py-1.5 bg-gradient-to-b from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-black text-xs font-bold border border-amber-300 border-b-2 border-b-amber-700 transition-all flex items-center gap-1 shadow-lg active:translate-y-[1px] active:border-b-[1px] ${
              canTrashSplit ? 'rounded-l-[2px]' : 'rounded-[2px]'
            }`}
          >
            <Plus className="w-3.5 h-3.5" /> {server ? server.name : 'New remote'}
            {iceCost > 0 && ` (${iceCost}c)`}
            {replaced && ' (replace)'}
            {a.faceUp && ' (faceup)'}
          </button>
        );

        if (!canTrashSplit || !server) return mainBtn;

        return (
          <div key={`${a.targetServerId ?? 'new'}${a.faceUp ? '-faceup' : ''}`} className="inline-flex items-stretch">
            {mainBtn}
            <TrashSplitSegment
              title={trashTitle(server.name)}
              onClick={() => {
                hoverPromptServer(null);
                hoverPromptTarget(null);
                setReplacing({ cardId: card.instanceId, serverId: server.id });
              }}
              onMouseEnter={() => hoverPromptServer(server.id)}
              onMouseLeave={() => hoverPromptServer(null)}
              testId={`install-replace-${server.id}`}
              className="border-amber-300 border-b-amber-700"
            />
          </div>
        );
      })}
      {trashOnlyServers.map(server => {
        const iceCost = def.type_code === 'ice' ? server.ice.length : 0;
        return (
          <div key={`trash-only-${server.id}`} className="inline-flex items-stretch">
            <button
              disabled
              title={`Cannot install normally — trash ${what} first`}
              className="px-3 py-1.5 bg-gradient-to-b from-amber-400 to-amber-600 opacity-40 cursor-not-allowed text-black text-xs font-bold rounded-l-[2px] border border-amber-300 border-b-2 border-b-amber-700 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> {server.name}
              {iceCost > 0 && ` (${iceCost}c)`}
            </button>
            <TrashSplitSegment
              title={trashTitle(server.name)}
              onClick={() => {
                hoverPromptServer(null);
                setReplacing({ cardId: card.instanceId, serverId: server.id });
              }}
              onMouseEnter={() => hoverPromptServer(server.id)}
              onMouseLeave={() => hoverPromptServer(null)}
              testId={`install-replace-${server.id}`}
              className="border-amber-300 border-b-amber-700"
            />
          </div>
        );
      })}
    </div>
  );
}
