import React from 'react';
import { clearSavedGame } from '../savedGame';

/**
 * Catches a crash anywhere in the app and offers a way out. The game in
 * progress resumes from localStorage on every load, so without this a game
 * that can't be drawn (a bug, or a save from an older version) would show a
 * blank page on every reload.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('The app crashed', error, info.componentStack);
  }

  private startOver = () => {
    clearSavedGame();
    // Drop ?seed=... too, so the reload opens the deck picker
    window.location.replace(window.location.pathname);
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6 font-mono text-slate-100" data-testid="crash-screen">
        <div className="max-w-md w-full bg-slate-950/95 border-2 border-red-700 chamfer p-5 shadow-2xl space-y-3">
          <h1 className="font-cyber font-black text-red-400 tracking-wider">SYSTEM FAILURE</h1>
          <p className="text-sm text-slate-300">
            Something went wrong and the game can't be shown. Starting over clears the saved game and goes back to deck
            selection. Your custom decks are kept.
          </p>
          <pre className="text-[11px] text-slate-500 whitespace-pre-wrap break-words max-h-32 overflow-auto">{error.message}</pre>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-bold rounded-lg"
            >
              Reload
            </button>
            <button
              onClick={this.startOver}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-lg"
            >
              Start over
            </button>
          </div>
        </div>
      </div>
    );
  }
}
