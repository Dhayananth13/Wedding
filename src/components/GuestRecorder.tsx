import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mic,
  RotateCcw,
  Square,
  Upload,
} from 'lucide-react';
import { formatConfirmationSummary } from '../shared/schemas.ts';
import { VoiceResponse, VoiceSchema } from '../shared/types.ts';

interface GuestRecorderProps {
  schemas: VoiceSchema[];
  activeSchema: VoiceSchema;
  onSelectSchema: (schemaId: string) => void;
  onResponseSubmitted: (response: VoiceResponse) => void;
}

type CaptureStatus = 'idle' | 'recording' | 'processing' | 'done' | 'error';

export const GuestRecorder: React.FC<GuestRecorderProps> = ({
  schemas,
  activeSchema,
  onSelectSchema,
  onResponseSubmitted,
}) => {
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [captureMode, setCaptureMode] = useState<'tap' | 'hold'>('tap');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [processingSeconds, setProcessingSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<VoiceResponse | null>(null);
  const [customDisambiguationValue, setCustomDisambiguationValue] = useState('');
  const [resolving, setResolving] = useState(false);
  const [deletingTake, setDeletingTake] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopVisualizerAndStream = () => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      stopVisualizerAndStream();
    };
  }, []);

  useEffect(() => {
    if (status === 'recording') {
      const startedAt = Date.now();
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((Date.now() - startedAt) / 1000);
      }, 100);
      return () => {
        if (timerRef.current) window.clearInterval(timerRef.current);
      };
    }

    if (status === 'processing') {
      const startedAt = Date.now();
      setProcessingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setProcessingSeconds((Date.now() - startedAt) / 1000);
      }, 100);
      return () => {
        if (timerRef.current) window.clearInterval(timerRef.current);
      };
    }

    return undefined;
  }, [status]);

  const drawIdleWaveform = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#CBD5E1';
    const bars = 36;
    const gap = width / bars;
    for (let i = 0; i < bars; i += 1) {
      const h = 4;
      ctx.fillRect(i * gap + gap * 0.25, (height - h) / 2, Math.max(2, gap * 0.5), h);
    }
  };

  useEffect(() => {
    if (status !== 'recording') {
      drawIdleWaveform();
    }
  }, [status]);

  const startVisualizer = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const render = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        analyser.getByteFrequencyData(dataArray);

        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);
        const barCount = Math.min(36, bufferLength);
        const step = width / barCount;

        for (let i = 0; i < barCount; i += 1) {
          const val = dataArray[i] / 255;
          const barHeight = Math.max(4, val * (height - 8));
          ctx.fillStyle = val > 0.45 ? '#2563EB' : '#64748B';
          ctx.fillRect(i * step + step * 0.25, (height - barHeight) / 2, Math.max(2, step * 0.5), barHeight);
        }

        animFrameRef.current = requestAnimationFrame(render);
      };

      render();
    } catch {
      // Waveform visualization is progressive enhancement; recording still works
    }
  };

  const uploadAudioBlob = async (blob: Blob, filename = 'voice-note.webm') => {
    setStatus('processing');
    setErrorMessage(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('audio', blob, filename);
      formData.append('schemaId', activeSchema.id);
      formData.append('mimeType', blob.type || 'audio/webm');

      const res = await fetch('/api/extract', {
        method: 'POST',
        body: formData,
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || `Extraction failed (${res.status})`);
      }

      const extracted = payload.response as VoiceResponse;
      setResult(extracted);
      setCustomDisambiguationValue('');
      setStatus('done');
      onResponseSubmitted(extracted);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong while processing audio.');
      setStatus('error');
    }
  };

  const startRecording = async () => {
    if (status === 'recording' || status === 'processing') return;
    setErrorMessage(null);
    setResult(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMessage('Microphone recording is not supported in this browser. Upload an audio clip below instead.');
      setStatus('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const mimeType = preferredTypes.find((type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type));

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const finalMime = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: finalMime });
        stopVisualizerAndStream();
        if (blob.size < 400) {
          setErrorMessage('Recording was too short. Hold or tap and speak for at least 1 second.');
          setStatus('error');
          return;
        }
        const ext = finalMime.includes('mp4') ? 'm4a' : finalMime.includes('ogg') ? 'ogg' : 'webm';
        void uploadAudioBlob(blob, `recording.${ext}`);
      };

      recorder.start(250);
      setStatus('recording');
      startVisualizer(stream);
    } catch (err) {
      stopVisualizerAndStream();
      setErrorMessage(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow mic access in your browser or upload an audio clip below.'
          : 'Could not start microphone recording. Check your mic or upload an audio clip below.'
      );
      setStatus('error');
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      stopVisualizerAndStream();
      setStatus('idle');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void uploadAudioBlob(file, file.name);
    e.target.value = '';
  };

  const handleResolveAmbiguity = async (numericValue: number) => {
    if (!result || !Number.isFinite(numericValue)) return;
    const numericKey =
      activeSchema.primaryNumericKey ?? activeSchema.fields.find((f) => f.type === 'number')?.key;
    if (!numericKey) return;

    setResolving(true);
    try {
      const res = await fetch(`/api/responses/${encodeURIComponent(result.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaId: activeSchema.id,
          fields: { [numericKey]: numericValue },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update number');
      setResult(data.response as VoiceResponse);
      onResponseSubmitted(data.response as VoiceResponse);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not save correction.');
    } finally {
      setResolving(false);
    }
  };

  const handleRejectAndReRecord = async () => {
    if (!result) {
      setStatus('idle');
      return;
    }
    setDeletingTake(true);
    try {
      await fetch(`/api/responses/${encodeURIComponent(result.id)}?schemaId=${encodeURIComponent(activeSchema.id)}`, {
        method: 'DELETE',
      });
    } catch {
      // Ignore cleanup network error and allow immediate re-record
    } finally {
      setDeletingTake(false);
      setResult(null);
      setErrorMessage(null);
      setStatus('idle');
    }
  };

  const primaryNumericKey =
    activeSchema.primaryNumericKey ?? activeSchema.fields.find((f) => f.type === 'number')?.key;

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-100">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Active Schema</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-700">{activeSchema.id}</span>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="guest-schema-select" className="sr-only">
                Select schema
              </label>
              <select
                id="guest-schema-select"
                value={activeSchema.id}
                onChange={(e) => {
                  setResult(null);
                  setErrorMessage(null);
                  setStatus('idle');
                  onSelectSchema(e.target.value);
                }}
                disabled={status === 'recording' || status === 'processing'}
                className="text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 min-h-[36px] focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                {schemas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-6">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
              {activeSchema.guestHeadline}
            </h1>
            <p className="mt-2 text-sm sm:text-base text-slate-600 leading-relaxed max-w-xl">
              {activeSchema.guestSubline}
            </p>
          </div>

          <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-4 mb-3">
              <span className="text-xs font-medium text-slate-600">
                {status === 'recording'
                  ? 'Listening to microphone'
                  : status === 'processing'
                    ? 'Processing voice note'
                    : 'Microphone waveform'}
              </span>
              <span className="font-mono text-xs text-slate-700 tabular-nums">
                {status === 'recording'
                  ? `${recordingSeconds.toFixed(1)}s`
                  : status === 'processing'
                    ? `${processingSeconds.toFixed(1)}s`
                    : 'Ready'}
              </span>
            </div>

            <canvas
              ref={canvasRef}
              width={560}
              height={64}
              className="w-full h-16 rounded-lg bg-white border border-slate-200"
            />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg" role="group" aria-label="Recording mode">
                <button
                  type="button"
                  onClick={() => setCaptureMode('tap')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap min-h-[34px] ${
                    captureMode === 'tap' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tap to record
                </button>
                <button
                  type="button"
                  onClick={() => setCaptureMode('hold')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap min-h-[34px] ${
                    captureMode === 'hold' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Hold to speak
                </button>
              </div>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.webm,.mp3,.wav,.m4a,.ogg"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={status === 'recording' || status === 'processing'}
                  className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap min-h-[36px] disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Upload audio clip</span>
                </button>
              </div>
            </div>

            <div className="mt-5">
              {status === 'processing' ? (
                <div className="w-full min-h-[64px] rounded-xl bg-slate-900 text-white px-6 py-4 flex items-center justify-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden="true" />
                  <span className="text-sm sm:text-base font-semibold">
                    Reasoning across your answer…
                  </span>
                </div>
              ) : captureMode === 'hold' ? (
                <button
                  type="button"
                  onPointerDown={() => void startRecording()}
                  onPointerUp={() => stopRecording()}
                  onPointerCancel={() => stopRecording()}
                  onKeyDown={(e) => {
                    if ((e.key === ' ' || e.key === 'Enter') && status !== 'recording') {
                      e.preventDefault();
                      void startRecording();
                    }
                  }}
                  onKeyUp={(e) => {
                    if ((e.key === ' ' || e.key === 'Enter') && status === 'recording') {
                      e.preventDefault();
                      stopRecording();
                    }
                  }}
                  className={`w-full min-h-[64px] rounded-xl px-6 py-4 flex items-center justify-center gap-3 text-base font-semibold transition-transform active:scale-[0.99] select-none touch-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                    status === 'recording'
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {status === 'recording' ? (
                    <>
                      <Square className="w-5 h-5 fill-current shrink-0" aria-hidden="true" />
                      <span>Release to send ({recordingSeconds.toFixed(1)}s)</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-5 h-5 shrink-0" aria-hidden="true" />
                      <span>Hold to speak</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (status === 'recording') {
                      stopRecording();
                    } else {
                      void startRecording();
                    }
                  }}
                  className={`w-full min-h-[64px] rounded-xl px-6 py-4 flex items-center justify-center gap-3 text-base font-semibold transition-transform active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                    status === 'recording'
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {status === 'recording' ? (
                    <>
                      <Square className="w-5 h-5 fill-current shrink-0" aria-hidden="true" />
                      <span>Tap to stop & extract ({recordingSeconds.toFixed(1)}s)</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-5 h-5 shrink-0" aria-hidden="true" />
                      <span>Tap to speak</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="mt-4 p-4 rounded-xl border border-red-200 bg-red-50 text-red-900 text-sm flex items-start gap-3"
            >
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-medium">Could not process recording</p>
                <p className="text-red-800 mt-0.5">{errorMessage}</p>
              </div>
            </div>
          )}

          <p className="mt-5 text-xs sm:text-sm text-slate-500 leading-relaxed">
            {activeSchema.samplePromptHindiEnglish}
          </p>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
          {!result ? (
            <div>
              <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100">
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Target Extraction Schema
                </h2>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {activeSchema.fields.length} fields
                </span>
              </div>

              <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                {activeSchema.description}
              </p>

              <div className="mt-5 divide-y divide-slate-100 border-t border-b border-slate-100">
                {activeSchema.fields.map((field) => (
                  <div key={field.key} className="py-3 flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{field.label}</div>
                      {field.type === 'enum' && field.options && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          {field.options.join(' · ')}
                        </div>
                      )}
                    </div>
                    <span className="font-mono text-xs text-slate-500 shrink-0">
                      {field.type}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-5 text-xs text-slate-500 leading-relaxed">
                Ambiguous phrases like <span className="font-mono text-slate-700">"do-teen log"</span> or{' '}
                <span className="font-mono text-slate-700">"dhai"</span> are automatically flagged for quick confirmation instead of silently guessed.
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  {result.needsFollowup ? (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                  )}
                  <span className={`text-xs font-semibold ${result.needsFollowup ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {result.needsFollowup ? 'Needs Follow-up' : 'Schema Validated'}
                  </span>
                </div>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {((result.transcribeMs + result.extractMs) / 1000).toFixed(1)}s · {result.attempts} pass
                </span>
              </div>

              <h2 className="mt-4 font-display text-xl font-bold text-slate-900 [text-wrap:balance]">
                {formatConfirmationSummary(activeSchema, result.fields)}
              </h2>

              {result.needsFollowup && (
                <div className="mt-4 p-4 rounded-xl border border-amber-300 bg-amber-50/70">
                  <p className="text-xs font-semibold text-amber-900">
                    Ambiguity detected — confirm exact count
                  </p>
                  <p className="text-xs text-amber-800 mt-1">
                    {result.followupReason}
                  </p>

                  {primaryNumericKey && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {(result.suggestedNumericChoices ?? [2, 3, 4]).map((num) => (
                        <button
                          key={num}
                          type="button"
                          disabled={resolving}
                          onClick={() => void handleResolveAmbiguity(num)}
                          className="px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors min-h-[36px] tabular-nums"
                        >
                          Confirm {num}
                        </button>
                      ))}
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          placeholder="Exact"
                          value={customDisambiguationValue}
                          onChange={(e) => setCustomDisambiguationValue(e.target.value)}
                          className="w-20 px-2.5 py-1.5 text-xs font-mono bg-white border border-amber-300 rounded-lg min-h-[36px]"
                        />
                        <button
                          type="button"
                          disabled={resolving || !customDisambiguationValue}
                          onClick={() => void handleResolveAmbiguity(Number(customDisambiguationValue))}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-40 min-h-[36px]"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5 divide-y divide-slate-100 border-t border-b border-slate-100">
                {activeSchema.fields.map((field) => {
                  const val = result.fields[field.key];
                  const conf = result.confidence[field.key] ?? 0;
                  const pct = Math.round(conf * 100);
                  return (
                    <div key={field.key} className="py-3 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs text-slate-500">{field.label}</div>
                        <div className="text-sm font-semibold text-slate-900 mt-0.5">
                          {val !== null && val !== undefined && val !== '' ? String(val) : 'Not mentioned'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={`font-mono text-xs font-medium tabular-nums ${
                            pct >= 80 ? 'text-emerald-700' : pct >= 60 ? 'text-amber-700' : 'text-slate-500'
                          }`}
                        >
                          {pct}% conf
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4">
                <div className="text-xs font-medium text-slate-500">Heard transcript</div>
                <p className="mt-1 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 leading-relaxed">
                  “{result.transcript}”
                </p>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={deletingTake}
                  onClick={() => void handleRejectAndReRecord()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors min-h-[40px]"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{deletingTake ? 'Removing…' : "That's wrong, re-record"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setErrorMessage(null);
                    setStatus('idle');
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors min-h-[40px]"
                >
                  <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Record another</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
