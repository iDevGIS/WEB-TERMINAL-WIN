#!/usr/bin/env python3
"""STT Worker using faster-whisper (GPU accelerated)"""
import sys
import io
import json

# Fix Windows encoding for Thai output
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from faster_whisper import WhisperModel

# Load model once (small = good balance of speed/accuracy)
model = WhisperModel("medium", device="cpu", compute_type="int8")

# Thai prompt hint — helps Whisper bias toward Thai script output
THAI_PROMPT = "สวัสดีครับ นี่คือการถอดเสียงภาษาไทย"

def transcribe(audio_path, lang=None):
    # First pass: use hint language or auto-detect
    prompt = THAI_PROMPT if lang == "th" else None
    segments, info = model.transcribe(audio_path, language=lang, beam_size=5, initial_prompt=prompt)
    text = " ".join([seg.text for seg in segments]).strip()
    detected = info.language
    
    # If auto-detected as non-Thai but text looks romanized Thai, retry with lang=th
    if not lang and detected != "th" and text:
        thai_words = ["sawat", "sawasdee", "khrap", "kha", "mai", "chai", "arai", "dee", "na", "ja"]
        lower = text.lower()
        if any(w in lower for w in thai_words):
            segments2, info2 = model.transcribe(audio_path, language="th", beam_size=5)
            text2 = " ".join([seg.text for seg in segments2]).strip()
            if text2:
                return {"text": text2, "language": "th"}
    
    return {"text": text, "language": detected}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: stt-worker.py <audio_file> [lang]"}))
        sys.exit(1)
    try:
        lang = sys.argv[2] if len(sys.argv) > 2 else None
        result = transcribe(sys.argv[1], lang)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
