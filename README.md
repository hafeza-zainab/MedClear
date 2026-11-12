# MedClear

MedClear is a hackathon project for the **AI x Healthcare** theme. It helps people understand visible information on a prescription or medicine package, review a simple daily plan, and identify questions they may want to ask a pharmacist.

> **MedClear is for information only. Always confirm with your doctor or pharmacist.** It does not diagnose, prescribe, or replace professional medical advice.

## Problem

Prescription instructions and medicine packaging can be difficult to read or understand, especially when a person is managing several medicines or needs an explanation in a familiar language.

## Solution

MedClear accepts a photo and asks a vision-capable language model to extract only the medicine details it can read. It presents those details in plain language, calls out unclear text, and offers a reviewable daily timeline. The app is designed to make questions easier to ask; it does not decide what treatment a person should take.

## Features

- Upload or take a prescription/medicine photo, with a preview and client-side resize to a maximum 1600 px edge.
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
   LLM_MODEL=gemini-2.5-flash
   LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
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

The routes call `{LLM_BASE_URL}/chat/completions`. Image input uses the OpenAI-compatible `image_url` content format with a base64 data URL. `LLM_BASE_URL` and `LLM_MODEL` are required; the server fails at startup with a clear error if either is missing.

To diagnose the analyze request locally, start `npm run dev` and in another terminal run `node scripts/test-analyze-route.mjs`. The script sends a synthetic one-pixel JPEG and prints only the sanitized upstream status and response body; the diagnostics response is enabled only in development.

## Narrated demo audio

The demo captions and narration script share `src/data/demo-scenes.json`. Narration is English only; the language scene shows localized on-screen text without speaking it. Generated files live in `public/audio/` and are committed with the app so running MedClear and watching the demo needs neither Python nor an internet connection.

To generate or update the narration MP3s, use Python and install the development-only dependency:

```bash
pip install -r requirements-dev.txt
python scripts/generate_narration.py
```

Generation requires Python, an internet connection, `edge-tts`, and `imageio-ffmpeg`. The generator trims leading and trailing silence while retaining about 150 ms at the end of each clip. It compares each scene's speech and voice hash with `public/audio/manifest.json`, regenerating missing or stale files; use `python scripts/generate_narration.py --force` to regenerate all scenes. The build logs a prominent warning when the manifest is stale. The default voice is `en-IN-NeerjaNeural` at its normal `+0%` rate; edit `VOICE` and `RATE` at the top of the script. Use `edge-tts --list-voices` to browse available voices. Run `python scripts/generate_narration.py --sample` to create comparison clips for three voices, or `python scripts/generate_narration.py --test-name` to compare app-name pronunciations in `public/audio/voice-samples/`.

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
