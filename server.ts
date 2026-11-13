import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { runVoiceExtractionPipeline } from './src/server/geminiPipeline.ts';
import {
  deleteResponse,
  getResponses,
  getSchemaById,
  listSchemas,
  pushResponse,
  saveCustomSchema,
  updateResponse,
} from './src/server/store.ts';
import { computeAggregates } from './src/shared/schemas.ts';
import { SchemaField, VoiceSchema } from './src/shared/types.ts';

const PORT = 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      storage: process.env.UPSTASH_REDIS_REST_URL ? 'upstash-redis' : 'local-json',
    });
  });

  app.get('/api/schemas', async (_req, res) => {
    try {
      const schemas = await listSchemas();
      res.json({ schemas });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list schemas.' });
    }
  });

  app.post('/api/schemas', async (req, res) => {
    try {
      const body = req.body as Partial<VoiceSchema>;
      const rawName = String(body.name ?? '').trim();
      if (!rawName) {
        return res.status(400).json({ error: 'Schema name is required.' });
      }
      if (!Array.isArray(body.fields) || body.fields.length === 0) {
        return res.status(400).json({ error: 'At least one schema field is required.' });
      }

      const slug =
        (body.id && String(body.id).trim()) ||
        rawName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') ||
        `schema-${Date.now()}`;

      const sanitizedFields: SchemaField[] = [];
      for (const f of body.fields) {
        const key = String(f.key ?? '')
          .trim()
          .replace(/[^a-zA-Z0-9_]/g, '');
        if (!key) continue;
        const type = f.type === 'number' || f.type === 'enum' ? f.type : 'string';
        const options =
          type === 'enum' && Array.isArray(f.options)
            ? f.options.map((o) => String(o).trim()).filter(Boolean)
            : undefined;
        if (type === 'enum' && (!options || options.length === 0)) {
          return res.status(400).json({ error: `Enum field "${key}" must include at least one option.` });
        }
        sanitizedFields.push({
          key,
          label: String(f.label ?? key).trim() || key,
          type,
          options,
          nullable: f.nullable !== false,
          description: f.description ? String(f.description).trim() : undefined,
        });
      }

      if (sanitizedFields.length === 0) {
        return res.status(400).json({ error: 'No valid fields found in schema definition.' });
      }

      const primaryGroup = sanitizedFields.find((f) => f.type === 'enum')?.key;
      const primaryNumeric = sanitizedFields.find((f) => f.type === 'number')?.key;

      const schema: VoiceSchema = {
        id: slug,
        name: rawName,
        description: String(body.description ?? '').trim() || `Custom voice extraction schema for ${rawName}.`,
        primaryGroupKey: body.primaryGroupKey || primaryGroup,
        primaryNumericKey: body.primaryNumericKey || primaryNumeric,
        samplePromptHindiEnglish:
          String(body.samplePromptHindiEnglish ?? '').trim() ||
          `Speak naturally about ${sanitizedFields.map((f) => f.label.toLowerCase()).join(', ')}.`,
        guestHeadline: String(body.guestHeadline ?? '').trim() || `${rawName} by voice`,
        guestSubline:
          String(body.guestSubline ?? '').trim() ||
          `Speak in Hindi, Hinglish, or English. Mention ${sanitizedFields.map((f) => f.label.toLowerCase()).join(', ')}.`,
        isBuiltIn: false,
        fields: sanitizedFields,
      };

      const saved = await saveCustomSchema(schema);
      return res.status(201).json({ schema: saved });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save schema.' });
    }
  });

  app.post('/api/extract', upload.single('audio'), async (req, res) => {
    try {
      const schemaId = String(req.body?.schemaId || 'wedding-rsvp').trim();
      const schema = await getSchemaById(schemaId);
      if (!schema) {
        return res.status(404).json({ error: `Unknown schemaId "${schemaId}".` });
      }

      const file = req.file;
      if (!file || !file.buffer || file.buffer.length === 0) {
        return res.status(400).json({ error: 'No audio recording was received. Please hold or tap to speak and try again.' });
      }

      const record = await runVoiceExtractionPipeline({
        audioBuffer: file.buffer,
        mimeType: file.mimetype || req.body?.mimeType,
        schema,
      });

      await pushResponse(record);
      return res.json({ response: record, schema });
    } catch (err) {
      console.error('Voice extraction error:', err);
      const message = err instanceof Error ? err.message : 'Failed to extract voice response.';
      const status = message.includes('GEMINI_API_KEY') ? 500 : 502;
      return res.status(status).json({ error: message });
    }
  });

  app.get('/api/responses', async (req, res) => {
    try {
      const schemaId = String(req.query.schemaId || 'wedding-rsvp').trim();
      const schema = await getSchemaById(schemaId);
      if (!schema) {
        return res.status(404).json({ error: `Unknown schemaId "${schemaId}".` });
      }

      const responses = await getResponses(schemaId);
      const aggregates = computeAggregates(schema, responses);
      return res.json({ schema, responses, aggregates });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch responses.' });
    }
  });

  app.patch('/api/responses/:id', async (req, res) => {
    try {
      const responseId = req.params.id;
      const schemaId = String(req.body?.schemaId || req.query.schemaId || 'wedding-rsvp').trim();
      const schema = await getSchemaById(schemaId);
      if (!schema) {
        return res.status(404).json({ error: `Unknown schemaId "${schemaId}".` });
      }

      const incomingFields = req.body?.fields as Record<string, string | number | null> | undefined;
      if (!incomingFields || typeof incomingFields !== 'object') {
        return res.status(400).json({ error: 'fields object is required.' });
      }

      const nextConfidence: Record<string, number> = {};
      for (const key of Object.keys(incomingFields)) {
        nextConfidence[key] = 1.0;
      }

      const updated = await updateResponse(schemaId, responseId, {
        fields: incomingFields,
        confidence: nextConfidence,
        needsFollowup: false,
        followupReason: undefined,
      });

      if (!updated) {
        return res.status(404).json({ error: 'Response not found.' });
      }

      return res.json({ response: updated });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update response.' });
    }
  });

  app.delete('/api/responses/:id', async (req, res) => {
    try {
      const responseId = req.params.id;
      const schemaId = String(req.query.schemaId || req.body?.schemaId || 'wedding-rsvp').trim();
      const deleted = await deleteResponse(schemaId, responseId);
      if (!deleted) {
        return res.status(404).json({ error: 'Response not found.' });
      }
      return res.json({ deleted: true });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete response.' });
    }
  });

  app.get('/api/export', async (req, res) => {
    try {
      const schemaId = String(req.query.schemaId || 'wedding-rsvp').trim();
      const schema = await getSchemaById(schemaId);
      if (!schema) {
        return res.status(404).json({ error: `Unknown schemaId "${schemaId}".` });
      }

      const responses = await getResponses(schemaId);
      const headers = ['id', 'createdAt', ...schema.fields.map((f) => f.key), 'needsFollowup', 'followupReason', 'transcript'];
      const escapeCsv = (val: unknown) => {
        const s = val === null || val === undefined ? '' : String(val);
        return `"${s.replace(/"/g, '""')}"`;
      };

      const rows = responses.map((r) =>
        [
          r.id,
          new Date(r.createdAt).toISOString(),
          ...schema.fields.map((f) => r.fields[f.key] ?? ''),
          r.needsFollowup ? 'true' : 'false',
          r.followupReason ?? '',
          r.transcript,
        ]
          .map(escapeCsv)
          .join(',')
      );

      const csv = [headers.join(','), ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="voiceform-${schemaId}.csv"`);
      return res.send(csv);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to export CSV.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VoiceForm server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start VoiceForm server:', err);
  process.exit(1);
});
