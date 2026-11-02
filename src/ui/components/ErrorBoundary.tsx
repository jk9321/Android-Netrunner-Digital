import React from 'react';
import { clearSavedGame, loadSavedGame } from '../savedGame';
import { BugReportButton } from './BugReportButton';
import { isChunkLoadError, reloadForNewBuild } from '../chunkReload';

/**
 * Catches a crash anywhere in the app and offers a way out. The game in
 * progress resumes from localStorage on every load, so without this a game
 * that can't be drawn (a bug, or a save from an older version) would show a
 * blank page on every reload.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null; reloading: boolean }> {
  state = { error: null as Error | null, reloading: false };

  static getDerivedStateFromError(error: Error) {
    // A screen's code from an older deploy is gone: reload once for the new
    // build (see chunkReload.ts) instead of showing the crash screen.
    return { error, reloading: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (this.state.reloading) {
      if (reloadForNewBuild()) return;
      this.setState({ reloading: false });
    }
    console.error('The app crashed', error, info.componentStack);
  }

  private startOver = () => {
    clearSavedGame();
    // Drop ?seed=... too, so the reload opens the deck picker
    window.location.replace(window.location.pathname);
  };

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    if (reloading) {
      return (
        <div className="min-h-screen flex items-center justify-center font-mono text-sm text-slate-400">
          New version found, reloading...
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center p-6 font-mono text-slate-100" data-testid="crash-screen">
        <div className="max-w-md w-full bg-[#090d15] border border-red-700/80 rounded-[2px] p-5 shadow-2xl space-y-3">
          <h1 className="font-cyber font-black text-red-400 tracking-wider">SYSTEM FAILURE</h1>
          <p className="text-sm text-slate-300">
            Something went wrong and the game can't be shown. Starting over clears the saved game and goes back to deck
            selection. Your custom decks are kept.
          </p>
          <pre className="text-[12px] text-slate-500 whitespace-pre-wrap break-words max-h-32 overflow-auto">{error.message}</pre>
          <div className="flex gap-2 justify-end">
            <BugReportButton
              screen="crash screen"
              crash={{ message: error.message, stack: error.stack }}
              game={loadSavedGame() ? () => loadSavedGame() : undefined}
              className="mr-auto"
            />
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-bold rounded-[2px] border border-slate-700 border-b-2 border-b-slate-600 active:translate-y-[1px] active:border-b-[1px]"
            >
              Reload
            </button>
            <button
              onClick={this.startOver}
              className="px-3 py-1.5 bg-gradient-to-b from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black text-xs font-bold rounded-[2px] border-b-2 border-amber-700 active:translate-y-[1px] active:border-b-[1px]"
            >
              Start over
            </button>
          </div>
        </div>
      </div>
    );
  }
}
