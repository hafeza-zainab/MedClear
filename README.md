# MedClear

MedClear is a hackathon project for the **AI x Healthcare** theme. It helps people understand visible information on a prescription or medicine package, review a simple daily plan, and identify questions they may want to ask a pharmacist.

> **MedClear is for information only. Always confirm with your doctor or pharmacist.** It does not diagnose, prescribe, or replace professional medical advice.

## Live scan availability

> Live scans use Google’s free Gemini API and can occasionally be slow, rate-limited or unavailable. If that happens, use ▶ Watch demo or Open sample results to see the complete flow.

## Problem

Prescription instructions and medicine packaging can be difficult to read or understand, especially when a person is managing several medicines or needs an explanation in a familiar language.

## Solution

MedClear accepts a photo and asks a vision-capable language model to extract only the medicine details it can read. It presents those details in plain language, calls out unclear text, and offers a reviewable daily timeline. The app is designed to make questions easier to ask; it does not decide what treatment a person should take.

## Features

- Upload or take a prescription/medicine photo, with a preview and client-side resize to a maximum 1024 px edge and about 1 MB.
- Server-side image analysis with schema-validated JSON output.
- Medicine cards for purpose, visible instructions, common side effects, cautions, and unreadable parts.
- English, Spanish, and French explanation choices. Medicine names remain in English.
- Daily timeline, local “Mark as taken” state, editable browser reminder times, and print/Save as PDF.
- Cautious duplicate ingredient and common interaction review, with pharmacist questions.
- Local sample result for a no-upload, no-analysis demonstration.
- Ten-scene guided demo with optional local narration MP3s and mute control.
- Persistent informational disclaimer.

## Tech stack

- Next.js 15 App Router and React 19
- TypeScript
- Tailwind CSS 4
- Zod validation
- OpenAI-compatible Chat Completions API called from server routes only

## Setup

1. Install Node.js 20.9 or later.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env.local` and add a server-side API key and a vision-capable model that supports JSON response mode:

   ```dotenv
   LLM_API_KEY=your_api_key
   LLM_MODEL=gemini-3.5-flash-lite
   LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
   LLM_FALLBACK_MODELS=gemini-3.6-flash,gemini-3.8-flash
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000), then choose **Try it** or use the sample on the scan page.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `LLM_API_KEY` | Yes for live AI features | API credential read only by server routes. Never prefix it with `NEXT_PUBLIC_`. |
| `LLM_MODEL` | Yes | Vision-capable model name. It must accept image inputs and follow JSON output instructions. |
| `LLM_BASE_URL` | Yes | Provider API base URL. For Gemini's OpenAI-compatible API, use `https://generativelanguage.googleapis.com/v1beta/openai`. |
| `LLM_FALLBACK_MODELS` | No | Comma-separated vision fallbacks for `/api/analyze`, tried in order after a primary-model timeout or HTTP 429/5xx. Defaults to `gemini-3.6-flash,gemini-3.8-flash`. The primary `gemini-3.5-flash-lite` is the low-latency first choice; the route makes no more than three upstream calls per scan. |

Analysis requests use up to 40 seconds per upstream call and a 70-second total budget. Render web services support long-running HTTP responses (up to 100 minutes), so Render's proxy timeout is not shorter than this route budget. The request logs show the model, resized image byte count, elapsed time, finish reason, and timeout status; they never include the API key or image bytes.

The routes call `{LLM_BASE_URL}/chat/completions`. Image input uses the OpenAI-compatible `image_url` content format with a base64 data URL. `LLM_BASE_URL` and `LLM_MODEL` are required; the server fails at startup with a clear error if either is missing.

To diagnose the analyze request locally, start `npm run dev` and in another terminal run `node scripts/test-analyze-route.mjs`. The script sends the fictional JPEG at `scripts/fixtures/test-prescription.jpg` and prints the parsed medicine count on success. On upstream failures it prints only the sanitized status and response body; route diagnostics are enabled only in development.

## Narrated demo audio

The demo captions and narration script share `src/data/demo-scenes.json`. Narration is English only; the language scene shows localized on-screen text without speaking it. The default `NARRATION_SOURCE=external` mode uses the audio files in `public/audio/` and skips generated-audio manifest checks during builds. For each scene, the tour tries `scene_01.mp3` through `scene_10.mp3`, then the matching `.m4a`, then `.wav`. Keep the two-digit scene names so they match the scene IDs. Audio URLs include a version query to bust browser and CDN caches. The supplied external scene audio is committed with the app, so watching the demo needs neither Python nor an internet connection.

To generate or update the narration MP3s, use Python and install the development-only dependency:

```bash
pip install -r requirements-dev.txt
python scripts/generate_narration.py
```

Generation requires Python, an internet connection, `edge-tts`, and `imageio-ffmpeg`. The generator trims leading and trailing silence while retaining about 150 ms at the end of each clip. In external mode, it refuses to overwrite an existing scene MP3 unless `--overwrite-external` is passed; it does not write a freshness manifest. To use generated narration and manifest checks instead, set `NARRATION_SOURCE=internal`. The default generated voice is `en-GB-SoniaNeural` at its normal `+0%` rate. Use `edge-tts --list-voices` to browse available voices. Run `python scripts/generate_narration.py --sample` to create the same short test sentence in en-GB-SoniaNeural, en-GB-RyanNeural, and en-GB-LibbyNeural, saved under the ignored `scripts/voice-samples/` folder. Run `python scripts/generate_narration.py --test-name` to compare the five app-name spellings in the default voice; add `--voice en-GB-RyanNeural` to choose a different voice.

Check scene files, durations, and caption word counts with:

```bash
npm run verify:audio
```

The verifier checks that each scene has an MP3, M4A, or WAV file and warns when its duration is under three seconds or over twenty five seconds. If no supported file loads in the browser, the tour silently uses its timed captions.

## Limitations

- Photo reading can miss or misread handwriting, abbreviations, strengths, and instructions. Check the original packaging and prescription.
- The safety check is automated and incomplete. It may miss duplicate ingredients or interactions and can produce false alerts. It is not a substitute for a pharmacist’s full medication review.
- Suggested schedule slots are a planning aid when the photo does not specify a time. Follow the original prescription and confirm unclear timing with a clinician or pharmacist.
- Browser reminders work only while the results page remains open and the browser permits notifications. They are not a dependable medication alarm service.
- “Mark as taken” is stored in this browser’s local storage; it is not shared across devices.
- The sample prescription is fictional demonstration content and is not treatment advice.
- AI translations and explanations may be imperfect.

## Checks

```bash
npm run lint
npm run build
```

## Export source code to a PDF

The helper script `scripts/export-code-pdf.ps1` collects project source/configuration files into a single print-ready HTML document. It skips `node_modules`, `.next`, Git metadata, lockfiles, and `.env.local`.

Run from PowerShell at the project root:

```powershell
./scripts/export-code-pdf.ps1
```

Open `medclear-code-submission.html` in a browser, press **Ctrl+P**, choose **Save as PDF**, and save the generated PDF. The HTML and PDF are submission artifacts and are not included in future source bundles.

## Disclaimer

**MedClear is for information only. Always confirm with your doctor or pharmacist.** Never use MedClear to diagnose a condition, start/stop a medicine, or change a dose. If you are worried about a medicine or have urgent symptoms, contact a qualified healthcare professional.
