import { useEffect, useMemo, useState } from 'react';
import { GuestRecorder } from './components/GuestRecorder.tsx';
import { HostDashboard } from './components/HostDashboard.tsx';
import { SchemaBuilder } from './components/SchemaBuilder.tsx';
import { AppView, TopBar } from './components/TopBar.tsx';
import { BUILT_IN_SCHEMAS } from './shared/schemas.ts';
import { VoiceSchema } from './shared/types.ts';

function readLocationState(): { view: AppView; schemaId: string } {
  if (typeof window === 'undefined') {
    return { view: 'guest', schemaId: 'wedding-rsvp' };
  }
  const url = new URL(window.location.href);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const viewParam = url.searchParams.get('view');
  let view: AppView = 'guest';
  if (path === '/dashboard' || viewParam === 'dashboard') {
    view = 'dashboard';
  } else if (path === '/schemas' || viewParam === 'schemas') {
    view = 'schemas';
  }
  const schemaId = url.searchParams.get('schemaId') || 'wedding-rsvp';
  return { view, schemaId };
}

export default function App() {
  const initial = useMemo(() => readLocationState(), []);
  const [activeView, setActiveView] = useState<AppView>(initial.view);
  const [activeSchemaId, setActiveSchemaId] = useState<string>(initial.schemaId);
  const [schemas, setSchemas] = useState<VoiceSchema[]>(BUILT_IN_SCHEMAS);

  useEffect(() => {
    fetch('/api/schemas')
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (payload?.schemas && Array.isArray(payload.schemas)) {
          setSchemas(payload.schemas as VoiceSchema[]);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const next = readLocationState();
      setActiveView(next.view);
      setActiveSchemaId(next.schemaId);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const syncUrl = (nextView: AppView, nextSchemaId: string) => {
    if (typeof window === 'undefined') return;
    const basePath = nextView === 'dashboard' ? '/dashboard' : nextView === 'schemas' ? '/schemas' : '/';
    const nextUrl = `${basePath}?schemaId=${encodeURIComponent(nextSchemaId)}`;
    window.history.pushState({}, '', nextUrl);
  };

  const handleNavigate = (view: AppView) => {
    setActiveView(view);
    syncUrl(view, activeSchemaId);
  };

  const handleSelectSchema = (schemaId: string) => {
    setActiveSchemaId(schemaId);
    syncUrl(activeView, schemaId);
  };

  const activeSchema = useMemo(
    () => schemas.find((s) => s.id === activeSchemaId) ?? schemas[0] ?? BUILT_IN_SCHEMAS[0],
    [schemas, activeSchemaId]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFBFD] text-slate-900">
      <TopBar activeView={activeView} onNavigate={handleNavigate} />

      <main className="flex-1">
        {activeView === 'guest' && (
          <GuestRecorder
            schemas={schemas}
            activeSchema={activeSchema}
            onSelectSchema={handleSelectSchema}
            onResponseSubmitted={() => undefined}
          />
        )}

        {activeView === 'dashboard' && (
          <HostDashboard
            schemas={schemas}
            activeSchema={activeSchema}
            onSelectSchema={handleSelectSchema}
            onOpenGuestView={() => handleNavigate('guest')}
          />
        )}

        {activeView === 'schemas' && (
          <SchemaBuilder
            schemas={schemas}
            activeSchema={activeSchema}
            onSelectSchema={handleSelectSchema}
            onSchemaCreated={(newSchema) => {
              setSchemas((prev) => [...prev.filter((s) => s.id !== newSchema.id), newSchema]);
              setActiveSchemaId(newSchema.id);
              syncUrl('guest', newSchema.id);
              setActiveView('guest');
            }}
            onOpenGuestView={() => handleNavigate('guest')}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div>VoiceForm · Open-source voice-to-structured-JSON engine</div>
          <div>Built by GenOS Team · MIT License</div>
        </div>
      </footer>
    </div>
  );
}
