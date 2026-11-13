import { DashboardAggregates, VoiceResponse, VoiceSchema } from './types.ts';

export const BUILT_IN_SCHEMAS: VoiceSchema[] = [
  {
    id: 'wedding-rsvp',
    name: 'Wedding RSVP',
    description: 'Headcount per function, dietary preference, and arrival details from Hinglish voice notes.',
    primaryGroupKey: 'function',
    primaryNumericKey: 'headcount',
    samplePromptHindiEnglish:
      'Example: "Namaste beta, hum Sharma family se bol rahe hain. Sangeet aur Wedding ke liye 4 log aayenge, sab veg hain, Friday subah 10 baje pahunch jayenge."',
    guestHeadline: 'Send your RSVP by voice',
    guestSubline: 'Speak naturally in Hindi, Hinglish, or English. Mention which function, how many guests, diet, and arrival.',
    isBuiltIn: true,
    fields: [
      {
        key: 'function',
        label: 'Function',
        type: 'enum',
        options: ['Mehendi', 'Sangeet', 'Wedding', 'Reception'],
        nullable: true,
        description: 'Primary wedding event the guest is confirming for.',
      },
      {
        key: 'headcount',
        label: 'Headcount',
        type: 'number',
        nullable: true,
        description: 'Exact number of people attending. Null if not mentioned.',
      },
      {
        key: 'diet',
        label: 'Diet',
        type: 'enum',
        options: ['veg', 'non-veg', 'jain', 'vegan'],
        nullable: true,
        description: 'Meal preference mentioned by the guest.',
      },
      {
        key: 'arrival',
        label: 'Arrival',
        type: 'string',
        nullable: true,
        description: 'Free-text arrival day, time, flight, or train detail.',
      },
    ],
  },
  {
    id: 'office-potluck',
    name: 'Office Potluck',
    description: 'Dish name, serving count, and dietary label captured from quick voice notes.',
    primaryGroupKey: 'dietaryFlag',
    primaryNumericKey: 'servings',
    samplePromptHindiEnglish:
      'Example: "Hey team, main Friday potluck ke liye Paneer Tikka la raha hoon, roughly 8 servings hongi, vegetarian hai, 12:30 PM tak desk pe rakh dunga."',
    guestHeadline: 'Log your potluck dish by voice',
    guestSubline: 'Say what dish you are bringing, how many servings, dietary flag, and when you will drop it off.',
    isBuiltIn: true,
    fields: [
      {
        key: 'dish',
        label: 'Dish',
        type: 'string',
        nullable: true,
        description: 'Name of the dish being brought.',
      },
      {
        key: 'servings',
        label: 'Servings',
        type: 'number',
        nullable: true,
        description: 'Number of people the dish serves.',
      },
      {
        key: 'dietaryFlag',
        label: 'Dietary Flag',
        type: 'enum',
        options: ['veg', 'non-veg', 'vegan', 'gluten-free', 'nut-free'],
        nullable: true,
        description: 'Dietary category of the dish.',
      },
      {
        key: 'arrivalWindow',
        label: 'Drop-off Time',
        type: 'string',
        nullable: true,
        description: 'When the dish will arrive at the office.',
      },
    ],
  },
];

export function formatConfirmationSummary(schema: VoiceSchema, fields: Record<string, string | number | null>): string {
  const parts: string[] = [];
  for (const field of schema.fields) {
    const val = fields[field.key];
    if (val === null || val === undefined || val === '') continue;
    if (field.key === 'headcount' && typeof val === 'number') {
      parts.push(`${val} ${val === 1 ? 'person' : 'people'}`);
    } else if (field.key === 'servings' && typeof val === 'number') {
      parts.push(`${val} ${val === 1 ? 'serving' : 'servings'}`);
    } else {
      parts.push(String(val));
    }
  }
  return parts.length > 0 ? `Got it: ${parts.join(', ')}` : 'Captured your voice note — review details below';
}

export function validateExtractedRecord(
  schema: VoiceSchema,
  candidate: unknown
): { valid: boolean; errors: string[]; sanitizedFields: Record<string, string | number | null>; sanitizedConfidence: Record<string, number> } {
  const errors: string[] = [];
  if (!candidate || typeof candidate !== 'object') {
    return {
      valid: false,
      errors: ['Model response is not a JSON object.'],
      sanitizedFields: {},
      sanitizedConfidence: {},
    };
  }

  const record = candidate as Record<string, unknown>;
  const rawFields = record.fields && typeof record.fields === 'object' ? (record.fields as Record<string, unknown>) : record;
  const rawConfidence =
    record.confidence && typeof record.confidence === 'object' ? (record.confidence as Record<string, unknown>) : {};

  const sanitizedFields: Record<string, string | number | null> = {};
  const sanitizedConfidence: Record<string, number> = {};

  for (const field of schema.fields) {
    const val = rawFields[field.key];

    if (val === undefined) {
      if (field.nullable) {
        sanitizedFields[field.key] = null;
      } else {
        errors.push(`Missing required field "${field.key}".`);
      }
    } else if (val === null) {
      if (field.nullable) {
        sanitizedFields[field.key] = null;
      } else {
        errors.push(`Field "${field.key}" cannot be null.`);
      }
    } else if (field.type === 'number') {
      const num = typeof val === 'number' ? val : Number(val);
      if (Number.isNaN(num) || !Number.isFinite(num)) {
        errors.push(`Field "${field.key}" must be a valid number or null, got ${JSON.stringify(val)}.`);
      } else {
        sanitizedFields[field.key] = num;
      }
    } else if (field.type === 'enum') {
      const str = String(val).trim();
      const matched = (field.options ?? []).find((opt) => opt.toLowerCase() === str.toLowerCase());
      if (!matched) {
        errors.push(
          `Field "${field.key}" must be one of [${(field.options ?? []).join(', ')}] or null, got ${JSON.stringify(val)}.`
        );
      } else {
        sanitizedFields[field.key] = matched;
      }
    } else {
      sanitizedFields[field.key] = String(val).trim() || null;
    }

    const rawConf = rawConfidence[field.key];
    if (typeof rawConf === 'number' && !Number.isNaN(rawConf)) {
      sanitizedConfidence[field.key] = Math.max(0, Math.min(1, Number(rawConf.toFixed(2))));
    } else {
      sanitizedConfidence[field.key] = sanitizedFields[field.key] === null ? 0.5 : 0.85;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitizedFields,
    sanitizedConfidence,
  };
}

export function computeAggregates(schema: VoiceSchema, responses: VoiceResponse[]): DashboardAggregates {
  const breakdownByGroup: Record<string, { responses: number; totalNumeric: number }> = {};

  const groupField = schema.primaryGroupKey
    ? schema.fields.find((f) => f.key === schema.primaryGroupKey)
    : schema.fields.find((f) => f.type === 'enum');

  const numericField = schema.primaryNumericKey
    ? schema.fields.find((f) => f.key === schema.primaryNumericKey)
    : schema.fields.find((f) => f.type === 'number');

  if (groupField?.options) {
    for (const option of groupField.options) {
      breakdownByGroup[option] = { responses: 0, totalNumeric: 0 };
    }
  }

  let needsFollowupCount = 0;
  let totalPrimaryNumeric = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const res of responses) {
    if (res.needsFollowup) needsFollowupCount += 1;

    const numVal = numericField ? res.fields[numericField.key] : null;
    const numericAmount = typeof numVal === 'number' && Number.isFinite(numVal) ? numVal : 0;
    totalPrimaryNumeric += numericAmount;

    if (groupField) {
      const groupVal = res.fields[groupField.key];
      const bucket = groupVal ? String(groupVal) : 'Unspecified';
      if (!breakdownByGroup[bucket]) {
        breakdownByGroup[bucket] = { responses: 0, totalNumeric: 0 };
      }
      breakdownByGroup[bucket].responses += 1;
      breakdownByGroup[bucket].totalNumeric += numericAmount;
    }

    for (const field of schema.fields) {
      const c = res.confidence[field.key];
      if (typeof c === 'number' && res.fields[field.key] !== null) {
        confidenceSum += c;
        confidenceCount += 1;
      }
    }
  }

  return {
    totalResponses: responses.length,
    needsFollowupCount,
    averageConfidence: confidenceCount > 0 ? Number((confidenceSum / confidenceCount).toFixed(2)) : 0,
    totalPrimaryNumeric,
    breakdownByGroup,
  };
}
