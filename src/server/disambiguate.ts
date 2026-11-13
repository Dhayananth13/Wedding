export interface AmbiguityMatch {
  isAmbiguous: boolean;
  phrase?: string;
  reason?: string;
  suggestedChoices?: number[];
}

interface PatternRule {
  regex: RegExp;
  label: string;
  choices?: number[];
}

const AMBIGUOUS_NUMBER_RULES: PatternRule[] = [
  // Hinglish / Hindi compound ranges
  { regex: /\b(ek[\s-]?do|1[\s-]?2|one\s*(?:or|to)\s*two)\b/i, label: 'range 1–2', choices: [1, 2] },
  { regex: /\b(do[\s-]?teen|2[\s-]?3|two\s*(?:or|to)\s*three)\b/i, label: 'range 2–3', choices: [2, 3] },
  { regex: /\b(teen[\s-]?ch[a]+r|3[\s-]?4|three\s*(?:or|to)\s*four)\b/i, label: 'range 3–4', choices: [3, 4] },
  { regex: /\b(ch[a]+r[\s-]?pa+nch|4[\s-]?5|four\s*(?:or|to)\s*five)\b/i, label: 'range 4–5', choices: [4, 5] },
  { regex: /\b(pa+nch[\s-]?ch[eh]+|5[\s-]?6|five\s*(?:or|to)\s*six)\b/i, label: 'range 5–6', choices: [5, 6] },
  { regex: /\b(ch[eh]+[\s-]?sa+t|6[\s-]?7|six\s*(?:or|to)\s*seven)\b/i, label: 'range 6–7', choices: [6, 7] },
  { regex: /\b(sa+t[\s-]?aa+th|7[\s-]?8|seven\s*(?:or|to)\s*eight)\b/i, label: 'range 7–8', choices: [7, 8] },
  { regex: /\b(das[\s-]?b[a]+rah|10[\s-]?12|ten\s*(?:or|to)\s*twelve)\b/i, label: 'range 10–12', choices: [10, 12] },
  { regex: /\b(bees[\s-]?pach+ees|20[\s-]?25)\b/i, label: 'range 20–25', choices: [20, 25] },

  // Devanagari compound ranges & fractions
  { regex: /(एक[\s-]?दो|दो[\s-]?तीन|तीन[\s-]?चार|चार[\s-]?पाँच|पाँच[\s-]?छह|ढाई|डेढ़|लगभग|करीब|तकरीबन)/, label: 'Hindi approximate quantity' },

  // Hindi colloquial approximations & fractional numbers
  { regex: /\b(dhai|dhaai)\b/i, label: 'fractional "dhai" (2.5 / ~250)', choices: [2, 3] },
  { regex: /\b(dedh)\b/i, label: 'fractional "dedh" (1.5)', choices: [1, 2] },
  { regex: /\b(sadhe|saadhe)\s+(teen|chaar|paanch|chhe|saat|aath|das|\d+)/i, label: 'fractional "sadhe"' },
  { regex: /\b(lagbhag|kareeb|qareeb|takreeban|taqreeban|andaazan|andazan)\b/i, label: 'approximate qualifier' },

  // English vague quantifiers
  { regex: /\b(a\s+couple\s+of|few\s+(?:people|guests|folks|servings)|several)\b/i, label: 'vague English quantifier', choices: [2, 3, 4] },
  { regex: /\b(around|roughly|approx(?:imately)?|maybe|about)\s+\d+\b/i, label: 'approximate number' },
  { regex: /\b\d+\s*(?:or|to|-)\s*\d+\s*(?:log|logo|people|guests|persons|members|servings|plates)?\b/i, label: 'numeric range' },
];

export function detectAmbiguousNumber(transcript: string): AmbiguityMatch {
  const cleaned = transcript.trim();
  if (!cleaned) {
    return { isAmbiguous: false };
  }

  for (const rule of AMBIGUOUS_NUMBER_RULES) {
    const match = cleaned.match(rule.regex);
    if (match) {
      const phrase = match[0].trim();
      let choices = rule.choices;

      if (!choices) {
        const rangeNums = phrase.match(/\d+/g);
        if (rangeNums && rangeNums.length >= 2) {
          const a = Number(rangeNums[0]);
          const b = Number(rangeNums[1]);
          if (Number.isFinite(a) && Number.isFinite(b) && b > a && b - a <= 5) {
            choices = Array.from({ length: b - a + 1 }, (_, i) => a + i);
          } else if (Number.isFinite(a) && Number.isFinite(b)) {
            choices = [a, b];
          }
        } else if (rangeNums && rangeNums.length === 1) {
          const n = Number(rangeNums[0]);
          if (Number.isFinite(n) && n > 0) {
            choices = [Math.max(1, n - 1), n, n + 1];
          }
        }
      }

      return {
        isAmbiguous: true,
        phrase,
        reason: `Ambiguous quantity "${phrase}" (${rule.label})`,
        suggestedChoices: choices,
      };
    }
  }

  return { isAmbiguous: false };
}
