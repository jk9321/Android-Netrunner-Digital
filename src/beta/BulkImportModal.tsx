import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DeckList } from '../data/decks';
import { groupMissingBySet } from '../data/deckPlayability';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Save, X } from 'lucide-react';
import { BulkCandidate, BulkFilter, MAX_DAYS, extractDeckRefs, fetchDecks, fetchDecksByDate, filterCandidates, isAlreadySaved } from './bulkImport';

interface BulkImportModalProps {
  /** Decks already saved, to mark lists imported before. */
  saved: DeckList[];
  onSave: (decks: DeckList[]) => void;
  onClose: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/**
 * Beta-only: fetch many NetrunnerDB decklists at once (pasted links/ids, or
 * everything published in a date range), filter them, and save the ticked
 * ones as custom decks.
 */
export const BulkImportModal: React.FC<BulkImportModalProps> = ({ saved, onSave, onClose }) => {
  const [mode, setMode] = useState<'links' | 'dates'>('links');
  const [links, setLinks] = useState('');
  const [from, setFrom] = useState(daysAgo(14));
  const [to, setTo] = useState(today());
  const [filter, setFilter] = useState<BulkFilter>({ playableOnly: true });
  const [candidates, setCandidates] = useState<BulkCandidate[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const refs = useMemo(() => extractDeckRefs(links), [links]);
  const shown = useMemo(() => (candidates ? filterCandidates(candidates, filter) : []), [candidates, filter]);
  const key = (c: BulkCandidate) => `${c.ref.kind}/${c.ref.id}`;
  const ticked = shown.filter(c => !unticked.has(key(c)) && !isAlreadySaved(c, saved));

  const run = async () => {
    setProgress('Loading NetrunnerDB card list…');
    setErrors([]);
    setCandidates(null);
    setUnticked(new Set());
    try {
      const onProgress = (done: number, total: number) => setProgress(`Fetched ${done} of ${total} ${mode === 'links' ? 'decks' : 'days'}…`);
      const res = mode === 'links' ? await fetchDecks(refs, onProgress) : await fetchDecksByDate(from, to, onProgress);
      setCandidates(res.candidates);
      setErrors(res.errors);
    } catch (e) {
      setErrors([(e as Error).message || 'Could not reach NetrunnerDB.']);
    } finally {
      setProgress(null);
    }
  };

  const toggle = (c: BulkCandidate) =>
    setUnticked(prev => {
      const next = new Set(prev);
      if (next.has(key(c))) next.delete(key(c));
      else next.add(key(c));
      return next;
    });
  const check = (label: string, k: 'playableOnly' | 'legalOnly' | 'startupOnly', title: string) => (
    <label className="flex items-center gap-1 cursor-pointer" title={title}>
      <input type="checkbox" checked={!!filter[k]} onChange={e => setFilter(f => ({ ...f, [k]: e.target.checked }))} />
      {label}
    </label>
  );
  const tab = (id: 'links' | 'dates', label: string) => (
    <button
      onClick={() => setMode(id)}
      className={`px-2.5 py-1 rounded-[2px] border border-b-2 text-xs active:translate-y-[1px] active:border-b-[1px] ${mode === id ? 'bg-indigo-600 border-indigo-400 border-b-indigo-700 text-white font-bold' : 'bg-slate-900 border-slate-700 border-b-slate-800 hover:border-slate-500 text-slate-300'}`}
    >
      {label}
    </button>
  );

  return createPortal(
    <div onClick={onClose} className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4" data-testid="bulk-import-modal">
      <div
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-[#090d15] border border-fuchsia-500/80 rounded-[2px] p-6 shadow-2xl font-mono text-slate-100"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 bg-[#0e1422] hover:bg-slate-800 rounded-[2px] text-slate-400 hover:text-white border border-slate-700 border-b-2 border-b-slate-600 active:translate-y-[1px] active:border-b-[1px]"
          title="Close (Esc)"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
        <h2 className="font-cyber font-bold tracking-wider text-fuchsia-300 mb-1">BULK IMPORT (BETA ONLY)</h2>
        <p className="text-xs text-slate-400 mb-3 pr-10">
          Fetch many NetrunnerDB decks at once and save the ones you tick. This tool only exists in beta builds.
        </p>
        <div className="flex gap-2 mb-3">
          {tab('links', 'Links or ids')}
          {tab('dates', 'Published between dates')}
        </div>
        {mode === 'links' ? (
          <>
            <textarea
              value={links}
              onChange={e => setLinks(e.target.value)}
              placeholder={'https://netrunnerdb.com/en/decklist/99164/…\n98786\nhttps://netrunnerdb.com/en/deck/view/<shared deck id>'}
              rows={6}
              autoFocus
              data-testid="bulk-links"
              className="w-full bg-[#080d15] border border-slate-700 rounded-[2px] p-2 text-xs focus:outline-none focus:border-fuchsia-400"
            />
            <p className="text-[12px] text-slate-500 mt-1">
              Any text works: every decklist link, shared deck link or bare decklist id in it is picked up ({refs.length} found).
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label>
              From <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5" />
            </label>
            <label>
              to <input type="date" value={to} onChange={e => setTo(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5" />
            </label>
            <span className="text-slate-500">(at most {MAX_DAYS} days; only decks with ≥1 ♥ or ★)</span>
          </div>
        )}
        <button
          onClick={() => void run()}
          disabled={!!progress || (mode === 'links' && refs.length === 0)}
          data-testid="bulk-fetch"
          className="mt-3 disabled:opacity-50 px-3 py-1.5 rounded-[2px] border border-fuchsia-500 border-b-2 border-b-fuchsia-700 bg-fuchsia-950 hover:bg-fuchsia-900 text-xs flex items-center gap-1 active:translate-y-[1px] active:border-b-[1px]"
        >
          <Download className="w-3.5 h-3.5" /> {progress ?? 'Fetch from NetrunnerDB'}
        </button>
        {errors.length > 0 && (
          <details className="mt-2 text-xs text-red-400" open={!candidates}>
            <summary className="cursor-pointer">{errors.length} could not be fetched</summary>
            <ul className="ml-5 list-disc">
              {errors.map(e => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        )}

        {candidates && (
          <div className="mt-4 border-t border-slate-800 pt-3 text-xs" data-testid="bulk-results">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <select
                value={filter.side ?? ''}
                onChange={e => setFilter(f => ({ ...f, side: (e.target.value || undefined) as BulkFilter['side'] }))}
                className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5"
              >
                <option value="">Both sides</option>
                <option value="corp">Corp</option>
                <option value="runner">Runner</option>
              </select>
              {check('Fully playable', 'playableOnly', 'Every card in the list is in this game')}
              {check('Legal', 'legalOnly', 'Passes the deck-building rules once missing cards are left out')}
              {check('Startup', 'startupOnly', 'Tagged with a Startup ban list on NetrunnerDB')}
              <input
                value={filter.text ?? ''}
                onChange={e => setFilter(f => ({ ...f, text: e.target.value }))}
                placeholder="Name, identity or author"
                className="flex-1 min-w-[10rem] bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5"
              />
            </div>
            <div className="text-slate-400 mb-1">
              {shown.length} of {candidates.length} decks shown · {ticked.length} ticked
              {shown.length > 0 && (
                <>
                  {' · '}
                  <button className="underline hover:text-slate-200" onClick={() => setUnticked(new Set())}>
                    tick all
                  </button>{' '}
                  <button className="underline hover:text-slate-200" onClick={() => setUnticked(new Set(shown.map(key)))}>
                    untick all
                  </button>
                </>
              )}
            </div>
            <ul className="divide-y divide-slate-800 border border-slate-800 rounded-[2px] max-h-[45vh] overflow-y-auto">
              {shown.map(c => {
                const d = c.result.deck!;
                const dup = isAlreadySaved(c, saved);
                const missingCopies = c.result.missing.reduce((n, m) => n + m.count, 0);
                return (
                  <li key={key(c)} className="px-2 py-1.5">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        disabled={dup}
                        checked={!dup && !unticked.has(key(c))}
                        onChange={() => toggle(c)}
                        data-testid={`bulk-tick-${c.ref.id}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="font-bold truncate">{d.name}</span>
                          <a href={c.url} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-slate-200" title="Open on NetrunnerDB">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <div className={d.side === 'corp' ? 'text-cyan-300' : 'text-pink-300'}>
                          {d.identity}
                          <span className="text-slate-500">
                            {c.author && ` · ${c.author}`}
                            {c.date && ` · ${c.date}`}
                            {c.mwl && ` · ${c.mwl}`}
                            {((c.votes ?? 0) > 0 || (c.favorites ?? 0) > 0) && ` · ♥ ${c.votes ?? 0} ★ ${c.favorites ?? 0}`}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-3">
                          {dup && <span className="text-slate-500">Already saved</span>}
                          {c.result.playable ? (
                            <span className="text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Fully playable
                            </span>
                          ) : (
                            <button className="text-amber-400 flex items-center gap-1 underline" onClick={() => setOpen(open === key(c) ? null : key(c))}>
                              <AlertTriangle className="w-3 h-3" /> {missingCopies} missing {missingCopies === 1 ? 'copy' : 'copies'}
                            </button>
                          )}
                          {c.result.problems.length > 0 && <span className="text-amber-400" title={c.result.problems.join('\n')}>Not legal yet</span>}
                        </div>
                        {open === key(c) && (
                          <div className="mt-1 text-amber-300/90">
                            {groupMissingBySet(c.result.missing).map(g => (
                              <div key={g.set}>
                                {g.set}: {g.cards.map(m => `${m.count}x ${m.title}`).join(', ')}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-[2px] border border-slate-700 border-b-2 border-b-slate-600 bg-slate-900 hover:bg-slate-800 text-xs active:translate-y-[1px] active:border-b-[1px]">
            Close
          </button>
          <button
            onClick={() => onSave(ticked.map(c => c.result.deck!))}
            disabled={ticked.length === 0}
            data-testid="bulk-save"
            className="disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-[2px] bg-gradient-to-b from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-bold text-xs flex items-center gap-1 border-b-2 border-amber-700 active:translate-y-[1px] active:border-b-[1px]"
          >
            <Save className="w-3.5 h-3.5" /> Save {ticked.length} deck{ticked.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
