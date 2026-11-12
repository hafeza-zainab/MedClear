"""Generate and freshness-track local MP3 narration for MedClear's demo."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# Change these defaults to configure generated narration. Use `edge-tts --list-voices` to browse.
VOICE = "en-IN-NeerjaNeural"
RATE = "+0%"
SILENCE_FILTER = "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_duration=0.05:start_threshold=-50dB,areverse,apad=pad_dur=0.15"

PRONUNCIATIONS = {
    "MedClear": "Medd Clear",
    "AI": "A I",
    "UI": "U I",
    "PDF": "P D F",
}

SAMPLE_VOICES = ("en-IN-NeerjaNeural", "en-IN-PrabhatNeural", "en-US-AriaNeural")
SAMPLE_TEXT = "MedClear makes medicine information clearer. You can switch explanations to other languages."
NAME_VARIANTS = ("Med Clear", "Medd Clear", "Med, Clear", "Meddy Clear", "M E D Clear")
ROOT = Path(__file__).resolve().parents[1]
SCENES_FILE = ROOT / "src" / "data" / "demo-scenes.json"
OUTPUT_DIR = ROOT / "public" / "audio"
MANIFEST_FILE = OUTPUT_DIR / "manifest.json"


def number_to_words(value: int) -> str:
    ones = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine")
    teens = ("ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen")
    tens = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")
    if value < 10:
        return ones[value]
    if value < 20:
        return teens[value - 10]
    if value < 100:
        return tens[value // 10] + (f" {ones[value % 10]}" if value % 10 else "")
    if value < 1000:
        remainder = value % 100
        return f"{ones[value // 100]} hundred" + (f" {number_to_words(remainder)}" if remainder else "")
    for scale, name in ((1_000_000_000, "billion"), (1_000_000, "million"), (1000, "thousand")):
        if value >= scale:
            remainder = value % scale
            return f"{number_to_words(value // scale)} {name}" + (f" {number_to_words(remainder)}" if remainder else "")
    return "zero"


def prepare_speech(text: str) -> str:
    speech = text.replace("’", "'").replace("‘", "'").replace("–", " ").replace("—", " ")
    for original, spoken in sorted(PRONUNCIATIONS.items(), key=lambda pair: len(pair[0]), reverse=True):
        speech = re.sub(rf"(?<!\w){re.escape(original)}(?!\w)", spoken, speech, flags=re.IGNORECASE)
    speech = re.sub(r"\([^)]*\)", " ", speech)
    speech = re.sub(r"\b\d+\b", lambda match: number_to_words(int(match.group())), speech)
    speech = speech.replace("/", " and ")
    speech = re.sub(r"[^\w\s,.'-]", " ", speech, flags=re.UNICODE)
    speech = re.sub(r"[-_]+", " ", speech)
    speech = re.sub(r"\s+([,.])", r"\1", speech)
    speech = re.sub(r"([,.])(?=\S)", r"\1 ", speech)
    return re.sub(r"\s+", " ", speech).strip()


def speech_hash(text: str, voice: str, rate: str) -> str:
    payload = f"{text}\0{voice}\0{rate}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def pronunciation_hash() -> str:
    payload = json.dumps(PRONUNCIATIONS, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def load_scenes() -> list[dict[str, str]]:
    try:
        scenes = json.loads(SCENES_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Could not read demo scenes at {SCENES_FILE}: {error}") from error
    expected_ids = [f"scene_{index:02d}" for index in range(1, 11)]
    if not isinstance(scenes, list) or [scene.get("id") for scene in scenes] != expected_ids:
        raise SystemExit("demo-scenes.json must contain scene_01 through scene_10 in order.")
    for scene in scenes:
        if not scene.get("caption") or not scene.get("speech"):
            raise SystemExit(f"Scene {scene['id']} needs both caption and speech text.")
        if scene["caption"] != scene["speech"]:
            raise SystemExit(f"Scene {scene['id']} caption and speech must match exactly.")
    return scenes


def load_manifest() -> dict:
    try:
        return json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"scenes": {}}


def check_internet() -> None:
    try:
        with urlopen(Request("https://www.microsoft.com", method="HEAD"), timeout=5):
            pass
    except HTTPError:
        # An HTTP response, including an error response, confirms connectivity.
        pass
    except (OSError, URLError, TimeoutError) as error:
        print(f"Internet check was inconclusive ({error}); trying Edge TTS. Generation will report clearly if it cannot connect.")


async def generate_clip(edge_tts, text: str, voice: str, output: Path) -> None:
    raw_output = output.with_name(f"{output.stem}.raw.mp3")
    try:
        await asyncio.wait_for(edge_tts.Communicate(text, voice, rate=RATE).save(str(raw_output)), timeout=30)
        trim_silence(raw_output, output)
        raw_output.unlink(missing_ok=True)
    except TimeoutError as error:
        raw_output.unlink(missing_ok=True)
        output.unlink(missing_ok=True)
        raise SystemExit(f"Timed out generating {output.name}. Check your internet connection and try again.") from error
    except SystemExit:
        raw_output.unlink(missing_ok=True)
        output.unlink(missing_ok=True)
        raise
    except Exception as error:  # edge-tts wraps service and network failures.
        raw_output.unlink(missing_ok=True)
        output.unlink(missing_ok=True)
        raise SystemExit(
            f"Could not generate {output.name}: {error}\n"
            "Check that edge-tts is installed and that you have an internet connection."
        ) from error


def trim_silence(source: Path, output: Path) -> None:
    try:
        import imageio_ffmpeg
    except ModuleNotFoundError as error:
        raise SystemExit("imageio-ffmpeg is missing. Install it with `pip install -r requirements-dev.txt`.") from error
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-af", SILENCE_FILTER,
        "-c:a", "libmp3lame", "-q:a", "4", str(output),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"Could not trim silence from {output.name} with bundled ffmpeg: {error}") from error
    if result.returncode != 0:
        raise SystemExit(f"Could not trim silence from {output.name} with bundled ffmpeg: {result.stderr.strip() or 'ffmpeg failed'}")


def load_edge_tts():
    try:
        import edge_tts
    except ModuleNotFoundError as error:
        if error.name == "edge_tts":
            raise SystemExit("edge-tts is missing. Install it with `pip install -r requirements-dev.txt`.") from error
        raise
    return edge_tts


async def generate_sample(edge_tts) -> None:
    check_internet()
    sample_dir = OUTPUT_DIR / "voice-samples"
    sample_dir.mkdir(parents=True, exist_ok=True)
    speech = prepare_speech(SAMPLE_TEXT)
    for voice in SAMPLE_VOICES:
        output = sample_dir / f"{voice}.mp3"
        await generate_clip(edge_tts, speech, voice, output)
        print(f"Created {output.relative_to(ROOT)}")


async def generate_name_tests(edge_tts) -> None:
    check_internet()
    sample_dir = OUTPUT_DIR / "voice-samples"
    sample_dir.mkdir(parents=True, exist_ok=True)
    for index, variant in enumerate(NAME_VARIANTS, start=1):
        output = sample_dir / f"name-{index:02d}.mp3"
        await generate_clip(edge_tts, variant, VOICE, output)
        print(f"{variant}: {output.resolve()}")


async def generate_scenes(edge_tts, force: bool) -> None:
    scenes = load_scenes()
    previous = load_manifest().get("scenes", {})
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    records: dict[str, dict[str, str]] = {}

    pending: list[dict[str, str]] = []
    for scene in scenes:
        scene_id = scene["id"]
        output = OUTPUT_DIR / f"{scene_id}.mp3"
        current_hash = speech_hash(scene["speech"], VOICE, RATE)
        old = previous.get(scene_id, {})
        stale = old.get("hash") != current_hash or old.get("voice") != VOICE or old.get("rate") != RATE
        if force or stale or not output.is_file():
            pending.append(scene)
        else:
            print(f"Keeping current {output.name}.")
        records[scene_id] = {"hash": current_hash, "voice": VOICE, "rate": RATE}

    if pending:
        check_internet()
    for scene in pending:
        output = OUTPUT_DIR / f"{scene['id']}.mp3"
        await generate_clip(edge_tts, prepare_speech(scene["speech"]), VOICE, output)
        print(f"Created {output.relative_to(ROOT)}")

    manifest = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "hash_format": "sha256(speech + NUL + voice + NUL + rate)",
        "pronunciation_hash": pronunciation_hash(),
        "silence_filter_hash": hashlib.sha256(SILENCE_FILTER.encode("utf-8")).hexdigest(),
        "scenes": records,
    }
    temp_file = MANIFEST_FILE.with_suffix(".json.tmp")
    temp_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp_file.replace(MANIFEST_FILE)
    print(f"Updated {MANIFEST_FILE.relative_to(ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate MP3 narration for MedClear's local demo tour.")
    parser.add_argument("--force", action="store_true", help="Regenerate every scene MP3.")
    parser.add_argument("--sample", action="store_true", help="Generate one short clip in three comparison voices.")
    parser.add_argument("--test-name", action="store_true", help="Generate name-pronunciation comparison clips in the current voice.")
    args = parser.parse_args()
    edge_tts = load_edge_tts()
    if args.sample and args.test_name:
        parser.error("Use either --sample or --test-name, not both.")
    if args.test_name:
        asyncio.run(generate_name_tests(edge_tts))
    elif args.sample:
        asyncio.run(generate_sample(edge_tts))
    else:
        asyncio.run(generate_scenes(edge_tts, args.force))


if __name__ == "__main__":
    main()
