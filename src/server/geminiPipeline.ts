import { GoogleGenAI, Schema, Type } from '@google/genai';
import { validateExtractedRecord } from '../shared/schemas.ts';
import { VoiceResponse, VoiceSchema } from '../shared/types.ts';
import { detectAmbiguousNumber } from './disambiguate.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is missing in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function normalizeAudioMimeType(mimeType?: string): string {
  if (!mimeType) return 'audio/webm';
  const base = mimeType.split(';')[0].trim().toLowerCase();
  if (base === 'audio/wave' || base === 'audio/x-wav') return 'audio/wav';
  if (base === 'audio/mp4' || base === 'audio/x-m4a') return 'audio/mp4';
  if (base === 'audio/mpeg') return 'audio/mp3';
  return base || 'audio/webm';
}

function buildGeminiResponseSchema(schema: VoiceSchema): Schema {
  const fieldProperties: Record<string, Schema> = {};
  const confidenceProperties: Record<string, Schema> = {};

  for (const field of schema.fields) {
    if (field.type === 'number') {
      fieldProperties[field.key] = {
        type: Type.NUMBER,
        nullable: field.nullable,
        description: field.description ?? field.label,
      };
    } else if (field.type === 'enum' && field.options && field.options.length > 0) {
      fieldProperties[field.key] = {
        type: Type.STRING,
        enum: field.options,
        nullable: field.nullable,
        description: field.description ?? field.label,
      };
    } else {
      fieldProperties[field.key] = {
        type: Type.STRING,
        nullable: field.nullable,
        description: field.description ?? field.label,
      };
    }

    confidenceProperties[field.key] = {
      type: Type.NUMBER,
      description: `Confidence score between 0.0 and 1.0 for ${field.key}`,
    };
  }

  return {
    type: Type.OBJECT,
    properties: {
      fields: {
        type: Type.OBJECT,
        properties: fieldProperties,
        required: schema.fields.map((f) => f.key),
      },
      confidence: {
        type: Type.OBJECT,
        properties: confidenceProperties,
        required: schema.fields.map((f) => f.key),
      },
      uncertainReason: {
        type: Type.STRING,
        nullable: true,
        description: 'Optional brief note if any field was ambiguous or implied.',
      },
    },
    required: ['fields', 'confidence'],
  };
}

export async function transcribeAudioBuffer(
  ai: GoogleGenAI,
  audioBuffer: Buffer,
  rawMimeType?: string
): Promise<{ transcript: string; durationMs: number }> {
  const start = Date.now();
  const mimeType = normalizeAudioMimeType(rawMimeType);
  const base64Data = audioBuffer.toString('base64');

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        {
          text:
            'Transcribe this voice note verbatim. The speaker may mix Hindi, Hinglish, and English. ' +
            'Preserve Hindi number phrases (such as "do-teen", "dhai", "dedh", "paanch-che", "lagbhag") accurately without rounding or converting them. ' +
            'Return only the transcript text.',
        },
      ],
    },
  });

  const transcript = (response.text ?? '').trim();
  if (!transcript) {
    throw new Error('Transcription returned empty text. Please speak clearly and try again.');
  }

  return {
    transcript,
    durationMs: Date.now() - start,
  };
}

export async function extractFieldsWithRetries(
  ai: GoogleGenAI,
  schema: VoiceSchema,
  transcript: string
): Promise<{
  fields: Record<string, string | number | null>;
  confidence: Record<string, number>;
  uncertainReason?: string;
  attempts: number;
  validationFailed: boolean;
  validationErrors: string[];
  durationMs: number;
}> {
  const start = Date.now();
  const responseSchema = buildGeminiResponseSchema(schema);
  const maxAttempts = 3; // 1 initial attempt + up to 2 retries

  const fieldSpecText = schema.fields
    .map((f) => {
      if (f.type === 'enum') {
        return `- "${f.key}" (enum: [${(f.options ?? []).join(', ')}], nullable: ${f.nullable}): ${f.description ?? f.label}`;
      }
      return `- "${f.key}" (${f.type}, nullable: ${f.nullable}): ${f.description ?? f.label}`;
    })
    .join('\n');

  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const retryNote =
      attempt > 1
        ? `\n\nPREVIOUS OUTPUT FAILED VALIDATION:\n${lastErrors.join('\n')}\nFix these exact schema errors now.`
        : '';

    const prompt = `Extract structured data from this Hinglish/Hindi/English voice transcript against the "${schema.name}" schema.

Schema fields:
${fieldSpecText}

Rules:
1. Only populate fields supported by the transcript. Use null when a field is not mentioned.
2. For enum fields, pick the exact matching option string from the allowed options list, or null.
3. For numeric fields, extract a number. If the speaker gave an approximate or range phrase (e.g. "do-teen", "2-3", "around 4"), put your conservative midpoint/lower estimate or null AND lower the confidence score for that field below 0.65.
4. Provide a confidence score from 0.0 to 1.0 for each field in "confidence".
${retryNote}

Transcript:
"""${transcript}"""`;

    try {
      const result = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'You are a strict schema-constrained JSON extraction engine for multilingual Indian voice notes (Hindi, Hinglish, English). Output only valid JSON matching the requested schema.',
          responseMimeType: 'application/json',
          responseSchema,
        },
      });

      const rawText = (result.text ?? '').trim();
      const parsed = JSON.parse(rawText);
      const validation = validateExtractedRecord(schema, parsed);

      if (validation.valid) {
        return {
          fields: validation.sanitizedFields,
          confidence: validation.sanitizedConfidence,
          uncertainReason: typeof parsed?.uncertainReason === 'string' ? parsed.uncertainReason : undefined,
          attempts: attempt,
          validationFailed: false,
          validationErrors: [],
          durationMs: Date.now() - start,
        };
      }

      lastErrors = validation.errors;
    } catch (err) {
      lastErrors = [err instanceof Error ? err.message : 'Failed to parse JSON output.'];
    }
  }

  // Fallback object if all retries failed validation: flag for human review
  const fallbackFields: Record<string, string | number | null> = {};
  const fallbackConfidence: Record<string, number> = {};
  for (const f of schema.fields) {
    fallbackFields[f.key] = null;
    fallbackConfidence[f.key] = 0.25;
  }

  return {
    fields: fallbackFields,
    confidence: fallbackConfidence,
    uncertainReason: `Schema validation failed after ${maxAttempts} attempts: ${lastErrors.join('; ')}`,
    attempts: maxAttempts,
    validationFailed: true,
    validationErrors: lastErrors,
    durationMs: Date.now() - start,
  };
}

export async function runVoiceExtractionPipeline(params: {
  audioBuffer: Buffer;
  mimeType?: string;
  schema: VoiceSchema;
}): Promise<VoiceResponse> {
  const ai = getGeminiClient();

  const { transcript, durationMs: transcribeMs } = await transcribeAudioBuffer(ai, params.audioBuffer, params.mimeType);

  const extraction = await extractFieldsWithRetries(ai, params.schema, transcript);
  const ambiguity = detectAmbiguousNumber(transcript);

  const numericKey = params.schema.primaryNumericKey ?? params.schema.fields.find((f) => f.type === 'number')?.key;
  const confidence = { ...extraction.confidence };

  let needsFollowup = extraction.validationFailed || ambiguity.isAmbiguous;
  const reasons: string[] = [];

  if (ambiguity.isAmbiguous && ambiguity.reason) {
    reasons.push(ambiguity.reason);
    if (numericKey && typeof confidence[numericKey] === 'number') {
      confidence[numericKey] = Math.min(confidence[numericKey], 0.55);
    }
  }

  if (extraction.validationFailed) {
    reasons.push(extraction.uncertainReason ?? 'Schema validation requires manual review');
  } else if (numericKey && confidence[numericKey] !== undefined && confidence[numericKey] < 0.65 && !ambiguity.isAmbiguous) {
    needsFollowup = true;
    reasons.push(extraction.uncertainReason ?? `Low confidence on ${numericKey} (${Math.round(confidence[numericKey] * 100)}%)`);
  }

  return {
    id: `vf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    schemaId: params.schema.id,
    transcript,
    fields: extraction.fields,
    confidence,
    needsFollowup,
    followupReason: reasons.length > 0 ? reasons.join(' · ') : undefined,
    suggestedNumericChoices: ambiguity.suggestedChoices,
    ambiguousPhrase: ambiguity.phrase,
    attempts: extraction.attempts,
    transcribeMs,
    extractMs: extraction.durationMs,
    createdAt: Date.now(),
  };
}
