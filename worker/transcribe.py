"""WhisperX transcription + word alignment + optional diarization. Imported only inside the GPU container."""
import os


def transcribe(wav_path: str, device: str = "cuda") -> dict:
    import whisperx  # heavy: torch + models

    audio = whisperx.load_audio(wav_path)
    model = whisperx.load_model("large-v3", device, compute_type="float16", download_root="/models/whisper")
    result = model.transcribe(audio, batch_size=16)
    language = result["language"]

    align_model, metadata = whisperx.load_align_model(language_code=language, device=device)
    result = whisperx.align(result["segments"], align_model, metadata, audio, device, return_char_alignments=False)

    # Diarization needs a Hugging Face token with the pyannote model terms accepted; skipped without it.
    if os.environ.get("HF_TOKEN"):
        from whisperx.diarize import DiarizationPipeline

        diarize = DiarizationPipeline(use_auth_token=os.environ["HF_TOKEN"], device=device)
        result = whisperx.assign_word_speakers(diarize(audio), result)

    return {"language": language, "segments": [compact(s) for s in result["segments"]]}


def compact(seg: dict) -> dict:
    """Short keys keep a 3 h transcript in the low MB range."""
    words = [
        {"w": w["word"], "s": round(w["start"], 2), "e": round(w["end"], 2), **({"sp": w["speaker"]} if "speaker" in w else {})}
        for w in seg.get("words", [])
        if "start" in w and "end" in w  # numerals/symbols WhisperX could not align
    ]
    return {"s": round(seg["start"], 2), "e": round(seg["end"], 2), "t": seg["text"].strip(), "sp": seg.get("speaker"), "words": words}
