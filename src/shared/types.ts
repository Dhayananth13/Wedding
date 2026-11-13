export type SchemaFieldType = 'enum' | 'number' | 'string';

export interface SchemaField {
  key: string;
  label: string;
  type: SchemaFieldType;
  options?: string[];
  nullable: boolean;
  description?: string;
}

export interface VoiceSchema {
  id: string;
  name: string;
  description: string;
  primaryGroupKey?: string;
  primaryNumericKey?: string;
  samplePromptHindiEnglish: string;
  guestHeadline: string;
  guestSubline: string;
  isBuiltIn?: boolean;
  fields: SchemaField[];
}

export interface VoiceResponse {
  id: string;
  schemaId: string;
  transcript: string;
  fields: Record<string, string | number | null>;
  confidence: Record<string, number>;
  needsFollowup: boolean;
  followupReason?: string;
  suggestedNumericChoices?: number[];
  ambiguousPhrase?: string;
  attempts: number;
  transcribeMs: number;
  extractMs: number;
  createdAt: number;
}

export interface DashboardAggregates {
  totalResponses: number;
  needsFollowupCount: number;
  averageConfidence: number;
  totalPrimaryNumeric: number;
  breakdownByGroup: Record<string, { responses: number; totalNumeric: number }>;
}

export interface ResponsesPayload {
  schema: VoiceSchema;
  responses: VoiceResponse[];
  aggregates: DashboardAggregates;
}
