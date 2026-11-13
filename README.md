# VoiceForm

**300 relatives will never fill a Google Form, but they'll send a 40-second voice note.**

VoiceForm is an open-source, self-hostable voice-to-structured-JSON engine built by **GenOS Team**. Speak a messy voice note in any mix of Hindi, Hinglish, or English, and VoiceForm transcribes it, extracts validated JSON against any host-defined schema, scores per-field confidence, and catches ambiguous numbers (such as *"do-teen log"* or *"dhai sau"*) for disambiguation instead of silently guessing.

Wedding RSVP collection is the flagship live demo, alongside an **Office Potluck** preset and a **Custom Schema Builder** to demonstrate schema-generic extraction.

## Features

- **Any-Schema Engine**: Define fields (`string`, `number`, `enum`) and switch schemas live on the host dashboard.
- **2-Stage Voice Pipeline**: Server-side audio transcription (`gemini-3.5-transcribe`) followed by schema-constrained JSON extraction (`gemini-4-hydrogen`) with strict server-side schema validation and automatic retry (up to 2 retries on malformed output).
- **Ambiguity Heuristic & Disambiguation**: Deterministic detection of vague Hindi/Hinglish/English quantity phrases (`do-teen`, `dhai`, `paanch-che`, `two or three`, `around 5`) that flags `needsFollowup` and lets guests or hosts resolve exact numbers in one tap.
- **Mobile-First Guest Recorder**: Hold-to-speak or tap-to-record `MediaRecorder` capture with live audio waveform visualization, audio upload fallback, instant structured read-back, and one-tap re-record.
- **Live Host Dashboard**: Auto-polling (`4s`) aggregate headcount breakdown, individual response log with transcripts and confidence scores, local QR code for guests, WhatsApp summary share link (`wa.me`), and CSV export.

## Architecture

```
Browser (MediaRecorder audio/webm)
  └── POST /api/extract (multipart/form-data: audio + schemaId)
        ├── 1. Transcribe audio -> Hinglish/Hindi/English text
        ├── 2. Extract JSON + per-field confidence (schema-constrained)
        ├── 3. Validate types & enums (retry up to 2x on mismatch)
        ├── 4. Ambiguous-number regex check -> needsFollowup flag
        └── 5. Persist record (Upstash Redis REST or local JSON store)
```

## Quick Start

```bash
npm install
cp .env.example .env
# Set GEMINI_API_KEY in .env
npm run dev
```

Open `http://localhost:3000`.

## Known Demo Scope

- The host dashboard (`/dashboard` / Host Dashboard tab) has no authentication wall for frictionless live event demos.
- `arrival` / free-text date fields remain strings rather than normalized ISO timestamps.

## License

MIT — GenOS Team
