"""Self-check for media.py against a real ffmpeg: python -I worker/test_media.py"""
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from media import MediaError, extract_audio, make_preview, probe  # noqa: E402


def main() -> None:
    with tempfile.TemporaryDirectory() as d:
        src = f"{d}/src.mp4"
        subprocess.run([
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30", "-f", "lavfi",
            "-i", "sine=frequency=440", "-t", "12", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-y", src,
        ], check=True)

        info = probe(src)
        assert abs(info["duration_s"] - 12) < 0.2, info
        assert (info["width"], info["height"], info["has_audio"]) == (1280, 720, True), info

        extract_audio(src, f"{d}/a.wav")
        assert os.path.getsize(f"{d}/a.wav") > 16000 * 2 * 10  # ~12 s of 16 kHz mono s16

        make_preview(src, 2.0, 7.0, f"{d}/p.mp4")
        p = probe(f"{d}/p.mp4")
        assert p["height"] == 480 and abs(p["duration_s"] - 5) < 0.3, p

        with open(f"{d}/fake.mp4", "w") as f:
            f.write("<html>not a video</html>")
        try:
            probe(f"{d}/fake.mp4")
            raise AssertionError("html accepted as video")
        except MediaError as e:
            assert e.code == "not_a_video"

        # A playlist pointing at a local file must not be readable (protocol whitelist).
        with open(f"{d}/evil.m3u8", "w") as f:
            f.write("#EXTM3U\n#EXTINF:1,\nconcat:file:///etc/hosts\n#EXT-X-ENDLIST\n")
        try:
            probe(f"{d}/evil.m3u8")
            raise AssertionError("playlist accepted")
        except MediaError:
            pass
    print("media ok")


if __name__ == "__main__":
    main()
