"""Generate local MP3 narration for MedClear's guided demo scenes."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

# Change these defaults as desired. Run `edge-tts --list-voices` to browse voices.
VOICE = "en-IN-NeerjaNeural"
RATE = "+0%"

ROOT = Path(__file__).resolve().parents[1]
SCENES_FILE = ROOT / "src" / "data" / "demo-scenes.json"
OUTPUT_DIR = ROOT / "public" / "audio"


async def generate(force: bool) -> None:
    try:
        import edge_tts
    except ModuleNotFoundError as error:
        if error.name == "edge_tts":
            raise SystemExit("edge-tts is missing. Install it with `pip install -r requirements-dev.txt`.") from error
        raise

    try:
        scenes = json.loads(SCENES_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Could not read demo scenes at {SCENES_FILE}: {error}") from error

    if len(scenes) != 10:
        raise SystemExit(f"Expected exactly 10 narration scenes; found {len(scenes)}.")
    expected_ids = [f"scene_{index:02d}" for index in range(1, 11)]
    if [scene.get("id") for scene in scenes] != expected_ids:
        raise SystemExit("Scene ids must be scene_01 through scene_10 in order.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    pending = [scene for scene in scenes if force or not (OUTPUT_DIR / f"{scene.get('id', '')}.mp3").exists()]
    if pending:
        try:
            with urlopen("https://www.microsoft.com", timeout=8):
                pass
        except HTTPError:
            # An HTTP error still confirms that internet connectivity is present.
            pass
        except (OSError, URLError, TimeoutError) as error:
            raise SystemExit(f"Narration generation needs internet access, but the connection failed: {error}") from error

    for scene in scenes:
        scene_id = scene.get("id", "")
        narration = scene.get("narration", "").strip()
        output = OUTPUT_DIR / f"{scene_id}.mp3"
        if not scene_id.startswith("scene_") or not narration:
            raise SystemExit(f"Scene is missing a valid id or narration: {scene!r}")
        if output.exists() and not force:
            print(f"Keeping existing {output.name} (use --force to replace it).")
            continue
        try:
            await asyncio.wait_for(
                edge_tts.Communicate(narration, VOICE, rate=RATE).save(str(output)),
                timeout=30,
            )
            print(f"Created {output.relative_to(ROOT)}")
        except TimeoutError as error:
            output.unlink(missing_ok=True)
            raise SystemExit(
                f"Timed out while generating {scene_id}. Check that you have an internet connection and try again."
            ) from error
        except Exception as error:  # edge-tts wraps network and service failures.
            output.unlink(missing_ok=True)
            raise SystemExit(
                f"Could not generate {scene_id}: {error}\n"
                "Check that Python dependencies are installed and that you have an internet connection."
            ) from error


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate MP3 narration for MedClear's local demo tour.")
    parser.add_argument("--force", action="store_true", help="Regenerate MP3s even when they already exist.")
    args = parser.parse_args()
    asyncio.run(generate(args.force))


if __name__ == "__main__":
    main()
