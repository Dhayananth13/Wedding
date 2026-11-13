import fs from 'node:fs';
import path from 'node:path';
import { BUILT_IN_SCHEMAS } from '../shared/schemas.ts';
import { VoiceResponse, VoiceSchema } from '../shared/types.ts';

interface PersistedStore {
  customSchemas: VoiceSchema[];
  responsesBySchema: Record<string, VoiceResponse[]>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'voiceform-store.json');

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useUpstash = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

let memoryStore: PersistedStore = {
  customSchemas: [],
  responsesBySchema: {},
};

function loadLocalStore(): PersistedStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedStore>;
      memoryStore = {
        customSchemas: Array.isArray(parsed.customSchemas) ? parsed.customSchemas : [],
        responsesBySchema: parsed.responsesBySchema && typeof parsed.responsesBySchema === 'object' ? parsed.responsesBySchema : {},
      };
    }
  } catch {
    // Keep clean in-memory store if file is unreadable
  }
  return memoryStore;
}

function saveLocalStore(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(memoryStore, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DATA_FILE);
  } catch {
    // Non-fatal in read-only runtimes; memoryStore stays intact
  }
}

loadLocalStore();

async function upstashCommand<T = unknown>(command: unknown[]): Promise<T> {
  const res = await fetch(`${UPSTASH_URL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    throw new Error(`Upstash Redis error: ${res.status}`);
  }
  const data = (await res.json()) as { result: T; error?: string };
  if (data.error) {
    throw new Error(`Upstash Redis error: ${data.error}`);
  }
  return data.result;
}

export async function listSchemas(): Promise<VoiceSchema[]> {
  if (useUpstash) {
    try {
      const raw = await upstashCommand<string | null>(['GET', 'voiceform:custom_schemas']);
      const custom = raw ? (JSON.parse(raw) as VoiceSchema[]) : [];
      return [...BUILT_IN_SCHEMAS, ...custom];
    } catch {
      return [...BUILT_IN_SCHEMAS, ...memoryStore.customSchemas];
    }
  }
  return [...BUILT_IN_SCHEMAS, ...memoryStore.customSchemas];
}

export async function getSchemaById(schemaId: string): Promise<VoiceSchema | undefined> {
  const all = await listSchemas();
  return all.find((s) => s.id === schemaId);
}

export async function saveCustomSchema(schema: VoiceSchema): Promise<VoiceSchema> {
  const existing = memoryStore.customSchemas.filter((s) => s.id !== schema.id);
  memoryStore.customSchemas = [...existing, { ...schema, isBuiltIn: false }];
  saveLocalStore();

  if (useUpstash) {
    try {
      await upstashCommand(['SET', 'voiceform:custom_schemas', JSON.stringify(memoryStore.customSchemas)]);
    } catch {
      // Fallback already persisted locally
    }
  }

  return schema;
}

export async function pushResponse(response: VoiceResponse): Promise<VoiceResponse> {
  const list = memoryStore.responsesBySchema[response.schemaId] ?? [];
  memoryStore.responsesBySchema[response.schemaId] = [response, ...list];
  saveLocalStore();

  if (useUpstash) {
    try {
      await upstashCommand(['LPUSH', `responses:${response.schemaId}`, JSON.stringify(response)]);
    } catch {
      // Fallback already persisted locally
    }
  }

  return response;
}

export async function getResponses(schemaId: string): Promise<VoiceResponse[]> {
  if (useUpstash) {
    try {
      const entries = await upstashCommand<string[]>(['LRANGE', `responses:${schemaId}`, 0, 499]);
      return entries.map((item) => JSON.parse(item) as VoiceResponse);
    } catch {
      return memoryStore.responsesBySchema[schemaId] ?? [];
    }
  }
  return memoryStore.responsesBySchema[schemaId] ?? [];
}

export async function updateResponse(
  schemaId: string,
  responseId: string,
  updates: Partial<Pick<VoiceResponse, 'fields' | 'confidence' | 'needsFollowup' | 'followupReason'>>
): Promise<VoiceResponse | null> {
  const current = await getResponses(schemaId);
  let updatedItem: VoiceResponse | null = null;
  const nextList = current.map((item) => {
    if (item.id !== responseId) return item;
    updatedItem = {
      ...item,
      ...updates,
      fields: updates.fields ? { ...item.fields, ...updates.fields } : item.fields,
      confidence: updates.confidence ? { ...item.confidence, ...updates.confidence } : item.confidence,
    };
    return updatedItem;
  });

  if (!updatedItem) return null;

  memoryStore.responsesBySchema[schemaId] = nextList;
  saveLocalStore();

  if (useUpstash) {
    try {
      const idx = nextList.findIndex((item) => item.id === responseId);
      if (idx >= 0) {
        await upstashCommand(['LSET', `responses:${schemaId}`, idx, JSON.stringify(updatedItem)]);
      }
    } catch {
      // Local store updated
    }
  }

  return updatedItem;
}

export async function deleteResponse(schemaId: string, responseId: string): Promise<boolean> {
  const current = await getResponses(schemaId);
  const nextList = current.filter((item) => item.id !== responseId);
  if (nextList.length === current.length) return false;

  memoryStore.responsesBySchema[schemaId] = nextList;
  saveLocalStore();

  if (useUpstash) {
    try {
      await upstashCommand(['DEL', `responses:${schemaId}`]);
      if (nextList.length > 0) {
        // Re-push in reverse order so LPUSH keeps newest-first order
        for (let i = nextList.length - 1; i >= 0; i -= 1) {
          await upstashCommand(['LPUSH', `responses:${schemaId}`, JSON.stringify(nextList[i])]);
        }
      }
    } catch {
      // Local store updated
    }
  }

  return true;
}
