#!/usr/bin/env python3
"""Spracherkennung für „Mit Hermes sprechen" (electron/stimmeHoeren.cjs).

Läuft dauerhaft im Python von Hermes (/usr/local/lib/hermes-agent/venv), das
faster-whisper schon mitbringt. Das Modell lädt einmal beim Start; danach je
Auftrag eine JSON-Zeile hinein ({"id", "pfad"}), eine heraus ({"id", "text",
"sek"} oder {"id", "fehler"}). Die Aufnahme kommt als WebM/Opus oder MP4 —
faster-whisper liest beides selbst (PyAV).

Umgebung: WHISPER_MODELL (Standard base), WHISPER_DIR (Modellablage, muss für
den Nutzer daily schreibbar sein), WHISPER_THREADS (Standard 2).
"""
import json
import os
import sys

from faster_whisper import WhisperModel

# Ein Satz Kontext hilft bei Namen und Wörtern, die im Gespräch oft fallen.
HINWEIS = "Paul spricht mit Hermes über seinen Tag, seine Aufgaben, sein Studium und sein Second Brain."


def antworte(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    modell = WhisperModel(
        os.environ.get("WHISPER_MODELL", "base"),
        device="cpu",
        compute_type="int8",
        cpu_threads=int(os.environ.get("WHISPER_THREADS", "2")),
        download_root=os.environ.get("WHISPER_DIR") or None,
    )
    antworte({"bereit": True})
    for zeile in sys.stdin:
        auftrag: dict = {}
        try:
            auftrag = json.loads(zeile)
            teile, info = modell.transcribe(
                auftrag["pfad"], language="de", beam_size=1, vad_filter=True, initial_prompt=HINWEIS,
            )
            text = " ".join(t.text.strip() for t in teile).strip()
            antworte({"id": auftrag["id"], "text": text, "sek": round(info.duration, 1)})
        except Exception as e:  # noqa: BLE001 — jeder Fehler gehört zum Auftrag, nicht zum Prozess
            antworte({"id": auftrag.get("id") if isinstance(auftrag, dict) else None, "fehler": str(e)[:200]})


if __name__ == "__main__":
    main()
