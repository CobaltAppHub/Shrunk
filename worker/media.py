"""Pure ffmpeg/ffprobe helpers. No Modal, no network clients: testable locally (see test_media.py)."""
import json
import subprocess

# Untrusted media: ffmpeg may only open the signed https URL or local files we created.
# Blocks playlist/concat tricks that make ffmpeg read other files or hosts.
PROTOCOLS = ["-protocol_whitelist", "file,https,tls,tcp,crypto"]


class MediaError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def probe(src: str) -> dict:
    """Duration and streams of the received file. Remote metadata is never trusted."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", *PROTOCOLS, "-print_format", "json", "-show_format", "-show_streams", src],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        raise MediaError("not_a_video")
    info = json.loads(out.stdout)
    streams = info.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not video:
        raise MediaError("not_a_video")
    duration = float(info.get("format", {}).get("duration") or video.get("duration") or 0)
    if duration <= 0:
        raise MediaError("not_a_video")
    return {
        "duration_s": duration,
        "width": int(video.get("width", 0)),
        "height": int(video.get("height", 0)),
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
    }


def extract_audio(src: str, dst_wav: str) -> None:
    """16 kHz mono WAV for ASR. Streams the source once; the video is never stored."""
    run(["ffmpeg", "-nostdin", "-v", "error", *PROTOCOLS, "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-y", dst_wav], timeout=3 * 3600)


def make_preview(src: str, start: float, end: float, dst: str) -> None:
    """Fast 480p preview of one candidate, original framing (the 9:16 speaker crop is the paid render)."""
    run([
        "ffmpeg", "-nostdin", "-v", "error", *PROTOCOLS,
        "-ss", f"{start:.3f}", "-i", src, "-t", f"{end - start:.3f}",
        "-vf", "scale=-2:480", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
        "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-y", dst,
    ], timeout=600)


def run(cmd: list, timeout: int, cwd: str | None = None) -> None:
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    if out.returncode != 0:
        raise MediaError("retrieval_failed")
