# VoiceForm — build prompt for an AI coding agent

**Event:** WeMakeDevs Festive Hacks, BIEC Bengaluru, Wed 25 Nov 2026, 9:00 AM–~5:00 PM IST, single on-site sitting.
**Compliance guardrail — read before doing anything:** Rule 4 says main coding and design work must start only after the hackathon kicks off (9:00 AM, 25 Nov). If you are being run before that time, do ONLY the Day-1 spikes below (exploratory `curl`/API calls to confirm facts) — that is research, not product work. Do not scaffold the repo, do not write application code, do not design UI, until the clock says go.

Team attribution: **GenOS Team** (never a real personal name, anywhere — README, LICENSE, UI footer, commit author if possible). MIT license.

---

## 1. One-sentence pitch

A stranger speaks a messy voice note in any mix of Hindi/English; VoiceForm turns it into clean structured JSON against a schema the host defines — demoed live as wedding RSVP collection (headcount per function, diet, arrival), because "300 relatives will never fill a Google Form, but they'll send a 40-second voice note."

**Platform framing (say this explicitly in the pitch, not just the wedding use case):** the engine takes *any* JSON schema + an audio clip and returns filled fields with confidence scores. Wedding RSVP is the demoed vertical, not the whole product — this is what keeps it from reading as a literal clone of the brief's own "RSVPs" bullet.

## 2. Judge-fit angles to hit explicitly in the demo narration

- **Kunal** (community/traction/open source): it's an open-source, self-hostable engine, not a one-off app; show real strangers on the conference floor using it during the day.
- **Hitesh** (practical, India-specific, "no patience for AI wrappers"): show the engineering beyond the LLM call — confidence scoring per field, a disambiguation follow-up when a number is ambiguous ("do-teen log" / "dhai sau"), schema validation that rejects malformed model output and retries.
- **Saiyam** (cloud native, self-hostable, scalable): a small stateless API, one Dockerfile, works the same locally and deployed — don't over-build, a clean container is enough, no Kubernetes claims.

## 3. Tech stack (decided, don't re-litigate on the day)

- **Framework:** Next.js 14, App Router, TypeScript. One codebase for frontend + API routes = no CORS, one deploy target, minimal context-switching for a solo build.
- **Audio capture:** browser-native `MediaRecorder` API. No client library.
- **STT + extraction:** Groq's hosted API, called via plain `fetch` to Groq's REST endpoints (NOT the `groq-sdk` npm package — fewer version unknowns under time pressure). Base URL `https://api.groq.com/openai/v1/`. A working Groq key already exists outside this chat (do not ask the user to paste it — read it from `.env.local`/Vercel env directly).
- **Storage:** Upstash Redis (`@upstash/redis`, REST client, serverless-friendly, free tier). Store each RSVP as a Redis list entry (`LPUSH`) per schema id; dashboard reads with `LRANGE`. Do NOT use local/file-based storage — it does not persist across Vercel serverless invocations.
- **Dashboard refresh:** plain polling (`fetch` every 4s). No websockets/SSE — not worth the build time for a one-day hack.
- **QR code:** `<img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=<url>">` — zero-dependency, zero spike risk. Don't add a QR npm package.
- **Hosting:** Vercel (`vercel --prod`), one command deploy, public URL reachable from any phone browser.
- **Repo:** public GitHub repo, name `voiceform`, MIT `LICENSE` file at root (not just mentioned in README — GitHub's About section only auto-populates from a real root-level file).

## 4. Env vars (`.env.example` — commit this, never the real values)

```
GROQ_API_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
NEXT_PUBLIC_BASE_URL=
```

## 5. Day-1 spikes — run these FIRST, before any product code, in this order

Each one can flip an architecture decision below, so don't skip ahead.

1. **Confirm the live Groq Whisper model id and multipart contract.** Hit `POST /audio/transcriptions` with a real short audio file using `curl -F model=... -F file=@clip.webm`. Model availability churns — do not trust a remembered model string, pull the current one from Groq's own docs/model list at spike time. Confirm it accepts a raw `audio/webm;codecs=opus` blob (Chrome/Android's default `MediaRecorder` output) without client-side transcoding — this is the single biggest unconfirmed assumption in this plan.
2. **Confirm structured JSON extraction reliability.** Send one real chat-completion call with the wedding-RSVP schema prompt and inspect whether the chosen Groq model's JSON-mode (`response_format: {"type": "json_object"}`, if supported) returns clean parseable JSON on the first try. If not reliable, fall back to a strict prompt + parse-with-retry loop (max 2 retries, then flag `needs_review: true` instead of looping forever).
3. **Confirm Upstash account/REST credentials can be provisioned in minutes.** If signup friction appears, fall back to Vercel KV (same REST-ish pattern, one less external account).
4. **Confirm `MediaRecorder` + mic-permission flow on Android Chrome specifically** (the real demo device population on an India conference floor). Don't spend spike time on iOS Safari quirks — Android is the target, not a stretch.
5. **Confirm Vercel Hobby plan's default serverless function timeout** against the real latency of transcribe→extract chained calls (STT + LLM back to back can run 5-10s). Set `maxDuration` in the route config if the default is too tight, rather than discovering a mid-demo timeout.

Write down what each spike actually returned (a line in `NOTES.md`, not memory) — Groq model names and Upstash onboarding specifically are the two most likely to have moved since this prompt was written.

## 6. Data model

```ts
// A "schema" is a host-defined extraction target. Only one preset is MVP; a second is a stretch goal.
type RsvpSchema = {
  id: "wedding-rsvp";
  fields: {
    function: { type: "enum"; options: ["Mehendi","Sangeet","Wedding","Reception"]; nullable: true };
    headcount: { type: "number"; nullable: true };
    diet: { type: "enum"; options: ["veg","non-veg","jain","vegan"]; nullable: true };
    arrival: { type: "string"; nullable: true }; // free text date/time, not parsed to a real Date — out of scope
  };
};

type Response = {
  id: string;
  schemaId: string;
  transcript: string;
  fields: Record<string, string | number | null>;
  confidence: Record<string, number>; // 0-1 per field
  needsFollowup: boolean;
  followupReason?: string; // e.g. "ambiguous headcount: 'do-teen log'"
  createdAt: number;
};
```

## 7. API routes

- `POST /api/extract` — body: `multipart/form-data` with `audio` (blob) and `schemaId`. Steps: transcribe (Groq Whisper) → extract (Groq chat completion, schema-constrained prompt) → validate against the schema shape (reject/retry if a required-shape field is missing or wrong type) → flag `needsFollowup` if any numeric field came from an ambiguous phrase (simple regex list: "do-teen", "dhai", "paanch-che", etc. — not a model call, a cheap heuristic) → `LPUSH` the record to Redis under key `responses:<schemaId>` → return the record to the client.
- `GET /api/responses?schemaId=wedding-rsvp` — `LRANGE` all records, return list + a server-computed aggregate (`{Sangeet: 12, Wedding: 18, Reception: 9}` summed headcounts per function, plus a raw count of responses and a count of `needsFollowup` flags).

## 8. Pages

- `/` (guest, mobile-first, no login): one big "Hold to speak" button → records → shows a spinner labelled "Reasoning across your answer…" during the real 5-10s round trip (narrate this honestly on camera, don't fake instant speed) → shows the extracted fields back ("Got it: Sangeet, 2 people, veg") with a "that's wrong, re-record" option.
- `/dashboard?schemaId=wedding-rsvp` (host, no auth needed for a demo — note this as a known gap in the README, not hidden): big aggregate numbers ("Tell the caterer: Sangeet 312, Wedding 588, Reception 640"), a live-updating table of individual responses with transcript + confidence shown per row, a QR code of the `/` link rendered via the img-tag trick above, a "share current counts" button that opens a `https://wa.me/?text=<url-encoded summary>` link (no WhatsApp API needed).

## 9. MVP scope — Must / Should / Could

**Must (ships even if the day goes badly):**
- Guest recording flow, `/api/extract` full chain, Redis storage, dashboard with live aggregate + list, QR code, Vercel deploy, public GitHub repo, MIT license, README, demo video, AI-disclosure line, `.env.example`, no secrets committed.

**Should (do these if Must finishes with time to spare):**
- Ambiguous-number follow-up heuristic (ships the "not a bare wrapper" story Hitesh needs — prioritize this over polish).
- A second schema preset (e.g. "office potluck: dish, servings, dietary flag") switchable via a dropdown on `/dashboard`, to prove genericity live by literally switching schemas in front of judges.

**Could (cut without guilt):**
- CSV export of responses.
- Language-hint selector passed to the Whisper `language` param.
- Any visual polish beyond "clean and readable."

**Out of scope — do not attempt:**
- WhatsApp Business API as an input channel (needs Meta number verification, takes days — confirmed dead for a same-day build).
- Any native mobile app.
- User accounts, login, or multi-tenant hosting beyond the single demo deployment.
- Real-time websockets/SSE (polling is enough).
- Parsing `arrival` into a real date/time type.
- Any face/photo/biometric feature (that was the prior BhejDe idea — explicitly roasted out, do not reintroduce).

## 10. Acceptance criteria — demo is not "done" until every line here is true

- [ ] A stranger opens the guest link on their own Android phone, taps record, speaks a mixed Hindi-English RSVP sentence, and sees "Got it: <function>, N people, <diet>" on screen within ~10 seconds.
- [ ] A second device open to `/dashboard` shows the new entry and updated aggregate counts within 5 seconds of the guest's submission (polling-driven, no manual refresh).
- [ ] At least one ambiguous number phrase is caught and flagged `needsFollowup` rather than silently guessed.
- [ ] Deployed at a public Vercel URL, reachable from a phone browser with no VPN/localhost step.
- [ ] Fresh clone: `git clone` → `npm install` → `.env.local` filled from `.env.example` → `npm run dev` works with no undocumented extra step.
- [ ] README: one-line problem statement, a 30-second GIF of the magic moment, the live URL, setup instructions, architecture diagram, a comparison line against Weddingkart (voice-first + schema-generic vs. their WhatsApp-RSVP-for-planners), the AI-assistance disclosure sentence, and real floor-usage numbers from the day (how many strangers actually used it).
- [ ] `git ls-files | grep -iE "\.(db|sqlite)(-|$)"` is empty, and a grep for `gsk_` / any Upstash token prefix across the tracked tree is empty.
- [ ] Demo video under 3 minutes, hook in the first 5 seconds, tested in incognito before submitting.
- [ ] `LICENSE` file at repo root (MIT), attribution "GenOS Team," no personal name anywhere in the tracked tree.

## 11. Demo video outline (≤3 min)

- 0:00–0:10: real pain line — "300 relatives will never fill a Google Form, but they'll send a voice note." Show the WhatsApp-group chaos it replaces.
- 0:10–0:30: a real stranger (or judge) speaking into the guest page, live, on the conference floor.
- 0:30–0:50: dashboard updating in real time, aggregate counts changing.
- 0:50–1:10: the ambiguous-number catch — show a phrase like "do-teen log" getting flagged, not silently guessed.
- 1:10–1:40: pull back to the platform framing — swap the schema dropdown live, same engine captures a potluck signup instead, to prove it's not a one-off wedding app.
- 1:40–2:10: architecture diagram, the exact API/model calls, honest latency narration ("it's genuinely transcribing and reasoning, not instant").
- 2:10–2:40: real numbers from the actual floor that day (N strangers, N responses, precision of the "sure" extractions).
- 2:40–2:50: "Open source, self-host it, bring your own schema."

## 12. Hour-by-hour plan for the 9:00–17:00 window

- **9:00–9:30:** Day-1 spikes 1-2 confirmed live (if not already done pre-event as pure research). Scaffold Next.js repo, env vars wired, Upstash + Groq keys confirmed working end to end with one throwaway curl-equivalent test route.
- **9:30–11:00:** `/api/extract` full chain working against a real recorded clip from your own phone. This is the riskiest piece — do not move on until it reliably returns valid JSON twice in a row.
- **11:00–12:00:** Guest page UI (`/`), recording, result display.
- **12:00–13:00:** Dashboard page, polling, aggregate counts, QR code.
- **13:00–13:30:** Deploy to Vercel, confirm the public URL works end-to-end from a phone on a different network (not your laptop's localhost).
- **13:30–14:30:** Walk the conference floor, get 10-15 real strangers to use it. This is your "real usage" evidence for the video and README — there is no week to accumulate it anymore, so this slot is not optional.
- **14:30–15:15:** Ambiguous-number follow-up heuristic (Should-have, do this before any visual polish).
- **15:15–15:45:** Second schema preset if time allows (Should-have #2).
- **15:45–16:15:** README, architecture diagram, comparison table, AI disclosure, secret-scan, LICENSE file check.
- **16:15–16:45:** Record the demo video, test in incognito.
- **16:45–17:00:** Submit. Do not wait for the literal deadline minute.
