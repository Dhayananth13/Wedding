import React, { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  RefreshCw,
  Share2,
  Trash2,
} from 'lucide-react';
import { ResponsesPayload, VoiceResponse, VoiceSchema } from '../shared/types.ts';

interface HostDashboardProps {
  schemas: VoiceSchema[];
  activeSchema: VoiceSchema;
  onSelectSchema: (schemaId: string) => void;
  onOpenGuestView: () => void;
}

export const HostDashboard: React.FC<HostDashboardProps> = ({
  schemas,
  activeSchema,
  onSelectSchema,
  onOpenGuestView,
}) => {
  const [data, setData] = useState<ResponsesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'followup' | 'confirmed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveDraft, setResolveDraft] = useState<Record<string, string>>({});

  const guestUrl = useMemo(() => {
    if (typeof window === 'undefined') return `/?schemaId=${activeSchema.id}`;
    return `${window.location.origin}/?schemaId=${encodeURIComponent(activeSchema.id)}`;
  }, [activeSchema.id]);

  const fetchResponses = useCallback(
    async (showLoader = false) => {
      if (showLoader) setLoading(true);
      try {
        const res = await fetch(`/api/responses?schemaId=${encodeURIComponent(activeSchema.id)}`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error || 'Failed to load dashboard');
        setData(payload as ResponsesPayload);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to refresh responses.');
      } finally {
        setLoading(false);
      }
    },
    [activeSchema.id]
  );

  useEffect(() => {
    void fetchResponses(true);
    const interval = window.setInterval(() => {
      void fetchResponses(false);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [fetchResponses]);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(guestUrl, {
      width: 260,
      margin: 1,
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [guestUrl]);

  const filteredResponses = useMemo(() => {
    const list = data?.responses ?? [];
    return list.filter((item) => {
      if (filterMode === 'followup' && !item.needsFollowup) return false;
      if (filterMode === 'confirmed' && item.needsFollowup) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTranscript = item.transcript.toLowerCase().includes(q);
        const inFields = Object.values(item.fields).some((v) => String(v ?? '').toLowerCase().includes(q));
        return inTranscript || inFields;
      }
      return true;
    });
  }, [data?.responses, filterMode, searchQuery]);

  const primaryNumericField =
    activeSchema.primaryNumericKey ?? activeSchema.fields.find((f) => f.type === 'number')?.key;

  const handleResolveRow = async (response: VoiceResponse, value: number) => {
    if (!primaryNumericField || !Number.isFinite(value)) return;
    setResolvingId(response.id);
    try {
      const res = await fetch(`/api/responses/${encodeURIComponent(response.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaId: activeSchema.id,
          fields: { [primaryNumericField]: value },
        }),
      });
      if (res.ok) {
        await fetchResponses(false);
      }
    } finally {
      setResolvingId(null);
    }
  };

  const handleDeleteRow = async (responseId: string) => {
    try {
      const res = await fetch(
        `/api/responses/${encodeURIComponent(responseId)}?schemaId=${encodeURIComponent(activeSchema.id)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        await fetchResponses(false);
      }
    } catch {
      // Ignore transient delete error
    }
  };

  const handleCopyGuestUrl = async () => {
    try {
      await navigator.clipboard.writeText(guestUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const whatsappHref = useMemo(() => {
    const aggs = data?.aggregates;
    if (!aggs) return 'https://wa.me/';
    const groupSummary = Object.entries(aggs.breakdownByGroup)
      .map(([group, stats]) => `${group}: ${stats.totalNumeric || stats.responses}`)
      .join(', ');
    const text = `VoiceForm ${activeSchema.name} counts (${aggs.totalResponses} voice responses): ${groupSummary}${
      aggs.needsFollowupCount > 0 ? ` (${aggs.needsFollowupCount} pending follow-up)` : ''
    }`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }, [activeSchema.name, data?.aggregates]);

  const aggregates = data?.aggregates;
  const breakdownEntries = Object.entries(aggregates?.breakdownByGroup ?? {});

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Host Console</span>
            <span aria-hidden="true">·</span>
            <span>Auto-polling every 4s</span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
            {activeSchema.name} Responses
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label htmlFor="dashboard-schema-select" className="sr-only">
            Switch schema
          </label>
          <select
            id="dashboard-schema-select"
            value={activeSchema.id}
            onChange={(e) => onSelectSchema(e.target.value)}
            className="text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg px-3 py-2 min-h-[38px] focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            {schemas.map((s) => (
              <option key={s.id} value={s.id}>
                Schema: {s.name}
              </option>
            ))}
          </select>

          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors whitespace-nowrap min-h-[38px]"
          >
            <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Share counts on WhatsApp</span>
          </a>

          <a
            href={`/api/export?schemaId=${encodeURIComponent(activeSchema.id)}`}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap min-h-[38px]"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export CSV</span>
          </a>

          <button
            type="button"
            onClick={() => void fetchResponses(false)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors min-h-[38px]"
            aria-label="Refresh responses"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-4 p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-900">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <div className="text-xs text-slate-500">Total voice responses</div>
          <div className="mt-1 font-display text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">
            {aggregates?.totalResponses ?? 0}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <div className="text-xs text-slate-500">
            Total {primaryNumericField ? primaryNumericField : 'count'}
          </div>
          <div className="mt-1 font-display text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">
            {aggregates?.totalPrimaryNumeric ?? 0}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <div className="text-xs text-slate-500">Needs follow-up</div>
          <div
            className={`mt-1 font-display text-2xl sm:text-3xl font-bold tabular-nums ${
              (aggregates?.needsFollowupCount ?? 0) > 0 ? 'text-amber-600' : 'text-slate-900'
            }`}
          >
            {aggregates?.needsFollowupCount ?? 0}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <div className="text-xs text-slate-500">Avg field confidence</div>
          <div className="mt-1 font-display text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">
            {aggregates?.totalResponses ? `${Math.round((aggregates.averageConfidence ?? 0) * 100)}%` : '—'}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-6">
          {breakdownEntries.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between gap-4 mb-4">
                <h2 className="font-display text-sm font-semibold text-slate-900">
                  {activeSchema.id === 'wedding-rsvp'
                    ? 'Tell the caterer (headcount by function)'
                    : 'Aggregate breakdown'}
                </h2>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {breakdownEntries.length} groups
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {breakdownEntries.map(([group, stats]) => (
                  <div key={group} className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                    <div className="text-xs font-medium text-slate-600 truncate">{group}</div>
                    <div className="mt-1 font-display text-xl font-bold text-slate-900 tabular-nums">
                      {primaryNumericField ? stats.totalNumeric : stats.responses}
                    </div>
                    <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                      {stats.responses} {stats.responses === 1 ? 'note' : 'notes'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg self-start">
                {(
                  [
                    ['all', 'All'],
                    ['followup', 'Follow-up'],
                    ['confirmed', 'Confirmed'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilterMode(key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      filterMode === key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search transcripts or fields…"
                aria-label="Search transcripts or fields"
                className="w-full sm:w-64 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus-visible:outline-2 focus-visible:outline-blue-600"
              />
            </div>

            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((row) => (
                  <div key={row} className="h-14 rounded-lg bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : filteredResponses.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm font-medium text-slate-900">
                  {(data?.responses.length ?? 0) === 0
                    ? `No ${activeSchema.name} voice responses yet`
                    : 'No matching responses for the current filter'}
                </p>
                <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
                  Share the QR code on the right with a guest on their phone, or open the Guest Recorder to submit the first voice note.
                </p>
                <button
                  type="button"
                  onClick={onOpenGuestView}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors min-h-[38px]"
                >
                  <span>Record first voice note</span>
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {filteredResponses.map((item) => {
                  const timeStr = new Date(item.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <div key={item.id} className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs">
                          {item.needsFollowup ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                              Follow-up needed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                              Validated
                            </span>
                          )}
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className="font-mono text-slate-500 tabular-nums">{timeStr}</span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className="font-mono text-slate-500 tabular-nums">
                            {((item.transcribeMs + item.extractMs) / 1000).toFixed(1)}s
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleDeleteRow(item.id)}
                          aria-label="Delete response"
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {activeSchema.fields.map((field) => {
                          const val = item.fields[field.key];
                          const conf = Math.round((item.confidence[field.key] ?? 0) * 100);
                          return (
                            <div key={field.key}>
                              <div className="text-[11px] text-slate-500">
                                {field.label} · <span className="font-mono tabular-nums">{conf}%</span>
                              </div>
                              <div className="text-sm font-semibold text-slate-900 mt-0.5 truncate">
                                {val !== null && val !== undefined && val !== '' ? String(val) : '—'}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <p className="mt-3 text-xs text-slate-600 leading-relaxed">
                        “{item.transcript}”
                      </p>

                      {item.needsFollowup && primaryNumericField && (
                        <div className="mt-3 pt-3 border-t border-amber-200/70 flex flex-wrap items-center justify-between gap-3">
                          <span className="text-xs text-amber-800">
                            {item.followupReason || 'Ambiguous number requires confirmation'}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {(item.suggestedNumericChoices ?? [2, 3]).map((choice) => (
                              <button
                                key={choice}
                                type="button"
                                disabled={resolvingId === item.id}
                                onClick={() => void handleResolveRow(item, choice)}
                                className="px-2.5 py-1 text-xs font-semibold text-slate-900 bg-amber-100 border border-amber-300 rounded hover:bg-amber-200 transition-colors tabular-nums"
                              >
                                Set {choice}
                              </button>
                            ))}
                            <input
                              type="number"
                              min={0}
                              placeholder="#"
                              value={resolveDraft[item.id] ?? ''}
                              onChange={(e) =>
                                setResolveDraft((prev) => ({ ...prev, [item.id]: e.target.value }))
                              }
                              className="w-14 px-2 py-1 text-xs font-mono border border-slate-300 rounded bg-white"
                            />
                            <button
                              type="button"
                              disabled={!resolveDraft[item.id] || resolvingId === item.id}
                              onClick={() => void handleResolveRow(item, Number(resolveDraft[item.id]))}
                              className="px-2.5 py-1 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 disabled:opacity-40"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Guest QR Code
          </h2>
          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
            Guests scan this on their phone and speak a 10–40s voice note. No login or app install required.
          </p>

          <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR code for ${activeSchema.name} voice recorder`}
                referrerPolicy="no-referrer"
                className="w-52 h-52 object-contain rounded-lg bg-white p-2 border border-slate-200"
              />
            ) : (
              <div className="w-52 h-52 flex items-center justify-center text-xs text-slate-500">
                Generating QR code…
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="text-[11px] font-medium text-slate-500 mb-1">Guest Link</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={guestUrl}
                aria-label="Guest link URL"
                className="flex-1 min-w-0 px-3 py-2 text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg"
              />
              <button
                type="button"
                onClick={() => void handleCopyGuestUrl()}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors min-h-[36px] inline-flex items-center gap-1.5 shrink-0"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenGuestView}
            className="mt-4 w-full py-2.5 px-4 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors min-h-[40px]"
          >
            Test Guest Recorder Now
          </button>
        </aside>
      </div>
    </section>
  );
};
