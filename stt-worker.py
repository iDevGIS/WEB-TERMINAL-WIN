#!/usr/bin/env python3
"""STT Worker using faster-whisper (GPU accelerated)"""
import sys
import json
from faster_whisper import WhisperModel

# Load model once (small = good balance of speed/accuracy)
model = WhisperModel("small", device="cpu", compute_type="int8")

def transcribe(audio_path):
    segments, info = model.transcribe(audio_path, language=None, beam_size=5)
    text = " ".join([seg.text for seg in segments]).strip()
    return {"text": text, "language": info.language}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: stt-worker.py <audio_file>"}))
        sys.exit(1)
    try:
        result = transcribe(sys.argv[1])
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
