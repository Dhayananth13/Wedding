import React, { useState } from 'react';
import { Check, Copy, Plus, Trash2 } from 'lucide-react';
import { SchemaField, SchemaFieldType, VoiceSchema } from '../shared/types.ts';

interface SchemaBuilderProps {
  schemas: VoiceSchema[];
  activeSchema: VoiceSchema;
  onSelectSchema: (schemaId: string) => void;
  onSchemaCreated: (schema: VoiceSchema) => void;
  onOpenGuestView: () => void;
}

interface DraftField {
  key: string;
  label: string;
  type: SchemaFieldType;
  optionsText: string;
  description: string;
}

export const SchemaBuilder: React.FC<SchemaBuilderProps> = ({
  schemas,
  activeSchema,
  onSelectSchema,
  onSchemaCreated,
  onOpenGuestView,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [samplePrompt, setSamplePrompt] = useState('');
  const [fields, setFields] = useState<DraftField[]>([
    { key: 'category', label: 'Category', type: 'enum', optionsText: 'Bug, Feature, Billing', description: 'Ticket category' },
    { key: 'urgency', label: 'Urgency', type: 'enum', optionsText: 'Low, Medium, High', description: 'Priority level' },
    { key: 'affectedUsers', label: 'Affected Users', type: 'number', optionsText: '', description: 'Estimated user count' },
    { key: 'summary', label: 'Summary', type: 'string', optionsText: '', description: 'Short issue summary' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const curlSnippet = `curl -X POST ${
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
  }/api/extract \\\n  -F "schemaId=${activeSchema.id}" \\\n  -F "audio=@voice-note.webm"`;

  const handleCopyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curlSnippet);
      setCopiedCurl(true);
      window.setTimeout(() => setCopiedCurl(false), 2000);
    } catch {
      // Ignore
    }
  };

  const handleAddField = () => {
    setFields((prev) => [
      ...prev,
      { key: `field_${prev.length + 1}`, label: `Field ${prev.length + 1}`, type: 'string', optionsText: '', description: '' },
    ]);
  };

  const handleRemoveField = (index: number) => {
    setFields((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleCreateSchema = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Give your schema a name.');
      return;
    }

    const formattedFields: SchemaField[] = fields
      .filter((f) => f.key.trim())
      .map((f) => ({
        key: f.key.trim().replace(/[^a-zA-Z0-9_]/g, ''),
        label: f.label.trim() || f.key.trim(),
        type: f.type,
        options:
          f.type === 'enum'
            ? f.optionsText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        nullable: true,
        description: f.description.trim() || undefined,
      }));

    setSaving(true);
    try {
      const res = await fetch('/api/schemas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          samplePromptHindiEnglish: samplePrompt.trim(),
          fields: formattedFields,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Could not save schema');
      onSchemaCreated(payload.schema as VoiceSchema);
      setName('');
      setDescription('');
      setSamplePrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schema.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      <div className="pb-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Any-Schema Voice Extraction Engine</div>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
            Schema Builder & API Contract
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={activeSchema.id}
            onChange={(e) => onSelectSchema(e.target.value)}
            aria-label="Inspect schema"
            className="text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg px-3 py-2 min-h-[38px]"
          >
            {schemas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.id})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onOpenGuestView}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors min-h-[38px]"
          >
            Test in Guest Recorder
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Active JSON Schema ({activeSchema.id})
            </h2>
            <pre className="mt-3 p-4 rounded-lg bg-slate-950 text-slate-100 text-xs overflow-x-auto leading-relaxed">
              {JSON.stringify(
                {
                  id: activeSchema.id,
                  name: activeSchema.name,
                  fields: activeSchema.fields.reduce<Record<string, unknown>>((acc, f) => {
                    acc[f.key] =
                      f.type === 'enum'
                        ? { type: 'enum', options: f.options, nullable: f.nullable }
                        : { type: f.type, nullable: f.nullable };
                    return acc;
                  }, {}),
                },
                null,
                2
              )}
            </pre>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Self-Host Stateless Endpoint
              </h2>
              <button
                type="button"
                onClick={() => void handleCopyCurl()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50"
              >
                {copiedCurl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCurl ? 'Copied' : 'Copy curl'}</span>
              </button>
            </div>
            <pre className="mt-3 p-4 rounded-lg bg-slate-950 text-slate-100 text-xs overflow-x-auto leading-relaxed">
              {curlSnippet}
            </pre>
          </div>
        </div>

        <form onSubmit={handleCreateSchema} className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Define a Custom Voice Schema
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Create any structured extraction schema and immediately capture Hinglish or English voice notes against it.
          </p>

          {error && (
            <div role="alert" className="mt-4 p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-900">
              {error}
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="schema-name" className="block text-xs font-medium text-slate-700 mb-1">
                Schema Name
              </label>
              <input
                id="schema-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Clinic Triage Intake"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus-visible:outline-2 focus-visible:outline-blue-600"
              />
            </div>

            <div>
              <label htmlFor="schema-desc" className="block text-xs font-medium text-slate-700 mb-1">
                Description
              </label>
              <input
                id="schema-desc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What should VoiceForm extract?"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus-visible:outline-2 focus-visible:outline-blue-600"
              />
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="schema-prompt" className="block text-xs font-medium text-slate-700 mb-1">
              Guest Hint (optional)
            </label>
            <input
              id="schema-prompt"
              type="text"
              value={samplePrompt}
              onChange={(e) => setSamplePrompt(e.target.value)}
              placeholder='Example: "Describe the issue, severity, and how many users are blocked."'
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus-visible:outline-2 focus-visible:outline-blue-600"
            />
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-800">Fields</span>
              <button
                type="button"
                onClick={handleAddField}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add field</span>
              </button>
            </div>

            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={index} className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-start">
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] text-slate-500 mb-1">JSON Key</label>
                    <input
                      type="text"
                      value={field.key}
                      onChange={(e) =>
                        setFields((prev) => prev.map((f, i) => (i === index ? { ...f, key: e.target.value } : f)))
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] text-slate-500 mb-1">Label</label>
                    <input
                      type="text"
                      value={field.label}
                      onChange={(e) =>
                        setFields((prev) => prev.map((f, i) => (i === index ? { ...f, label: e.target.value } : f)))
                      }
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-500 mb-1">Type</label>
                    <select
                      value={field.type}
                      onChange={(e) =>
                        setFields((prev) =>
                          prev.map((f, i) => (i === index ? { ...f, type: e.target.value as SchemaFieldType } : f))
                        )
                      }
                      className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="enum">enum</option>
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] text-slate-500 mb-1">
                      {field.type === 'enum' ? 'Options (comma-sep)' : 'Description'}
                    </label>
                    {field.type === 'enum' ? (
                      <input
                        type="text"
                        value={field.optionsText}
                        onChange={(e) =>
                          setFields((prev) =>
                            prev.map((f, i) => (i === index ? { ...f, optionsText: e.target.value } : f))
                          )
                        }
                        placeholder="opt1, opt2"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                      />
                    ) : (
                      <input
                        type="text"
                        value={field.description}
                        onChange={(e) =>
                          setFields((prev) =>
                            prev.map((f, i) => (i === index ? { ...f, description: e.target.value } : f))
                          )
                        }
                        placeholder="Field hint"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                      />
                    )}
                  </div>
                  <div className="sm:col-span-1 flex sm:justify-end pt-5">
                    <button
                      type="button"
                      disabled={fields.length <= 1}
                      onClick={() => handleRemoveField(index)}
                      aria-label="Remove field"
                      className="p-1.5 text-slate-400 hover:text-red-600 disabled:opacity-30"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors min-h-[40px] disabled:opacity-50"
            >
              {saving ? 'Saving Schema…' : 'Create & Activate Schema'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
};
