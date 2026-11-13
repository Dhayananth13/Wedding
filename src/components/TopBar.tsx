import React from 'react';

export type AppView = 'guest' | 'dashboard' | 'schemas';

interface TopBarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
}

export const TopBar: React.FC<TopBarProps> = ({ activeView, onNavigate }) => {
  const linkClass = (view: AppView) =>
    `text-sm font-medium transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
      activeView === view
        ? 'text-slate-900 border-blue-600'
        : 'text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300'
    }`;

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-8">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('guest');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 rounded"
        >
          VoiceForm
        </a>

        <nav className="flex items-center gap-6 overflow-x-auto" aria-label="Primary navigation">
          <button type="button" onClick={() => onNavigate('guest')} className={linkClass('guest')}>
            Guest Recorder
          </button>
          <button type="button" onClick={() => onNavigate('dashboard')} className={linkClass('dashboard')}>
            Host Dashboard
          </button>
          <button type="button" onClick={() => onNavigate('schemas')} className={linkClass('schemas')}>
            Schema Builder
          </button>
        </nav>

        <div className="hidden sm:flex items-center shrink-0">
          {activeView === 'dashboard' ? (
            <button
              type="button"
              onClick={() => onNavigate('guest')}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 min-h-[36px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              Open Guest View
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 min-h-[36px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              Live Dashboard
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
