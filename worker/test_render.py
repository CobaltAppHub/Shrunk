"""Self-check for vision.py and render.py: python -I worker/test_render.py
Needs ffmpeg with libass, numpy and scenedetect (see worker/requirements-dev.txt).
Face detection runs too when MP_FACE_MODEL points to blaze_face_short_range.tflite; otherwise it is skipped."""
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402

from media import probe  # noqa: E402
from render import ass_color, ass_time, build_ass, build_sendcmd, group_lines, render  # noqa: E402
from vision import crop_track, detect_scenes, make_proxy, peaks_from_rms, rms_windows  # noqa: E402

W = lambda w, s, e, **k: {"w": w, "s": s, "e": e, **k}  # noqa: E731


def ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", *args], check=True)


def loudness(path: str) -> float:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", out)[-1])


def test_pure():
    assert ass_color("#22C55E") == "&H005EC522"
    assert ass_time(3725.456) == "1:02:05.46"
    words = [W("un", 0, .3), W("deux", .35, .6), W("trois", .65, .9), W("quatre", .95, 1.2), W("cinq", 2.5, 2.8)]
    lines = group_lines(words)
    assert [len(l) for l in lines] == [3, 1, 1], lines  # 3 words max, break on the 1.3 s pause
    ass = build_ass([W("a{b}\\c", 0, .5, emphasis=True), W("ok", .5, 1)], {"preset": "bold", "position": "top"}, 1080, 1920, True)
    assert "a(b)c".upper() in ass and "{b}" not in ass, "override braces from user text must be neutralised"
    assert ass.count("Dialogue: 0,") == 2 and "Mark,,0,0,0,,Shrunk" in ass
    assert ",8," in ass.split("Style: Cap,")[1].split("\n")[0]  # top alignment
    assert build_sendcmd([(0, .5), (1.5, .25)]) == "0.00 crop@c x iw*0.5000-ow/2;\n1.50 crop@c x iw*0.2500-ow/2;\n"

    # crop track: largest face wins, gaps hold, clamped inside the frame, no smoothing across a cut
    samples = [(0.0, [(0.2, .5, .05, .1), (0.8, .5, .2, .3)]), (0.5, []), (1.0, [(0.9, .5, .2, .3)]),
               (2.0, [(0.1, .5, .2, .3)]), (2.5, [(0.1, .5, .2, .3)])]
    tr = dict(crop_track(samples, [(0, 2), (2, 3)], 1920, 1080))
    half = (1080 * 9 / 16) / 1920 / 2
    assert tr[0.0] == 0.8 and tr[0.5] == 0.8, tr
    assert 0.8 < tr[1.0] <= 1 - half + 1e-9, tr
    assert tr[2.0] == round(half, 4), "new scene starts on its own face, clamped, not panned from the last scene"
    assert crop_track(samples, [(0, 3)], 1080, 1920) == []  # portrait source: no horizontal crop

    rms = np.full(40, 0.1)
    rms[[10, 11, 30]] = 0.9
    assert peaks_from_rms(rms) == [5.0, 15.0], peaks_from_rms(rms)
    assert peaks_from_rms(np.zeros(10)) == []


def test_media(d: str):
    # 8 s, hard cut at 4 s, 1280x720, with a tone that changes loudness
    ff("-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=4", "-f", "lavfi", "-i", "smptebars=size=1280x720:rate=30:duration=4",
       "-f", "lavfi", "-i", "sine=frequency=300:duration=8", "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v];[2:a]volume=-30dB[a]",
       "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-y", f"{d}/src.mp4")
    make_proxy(f"{d}/src.mp4", f"{d}/proxy.mp4")
    scenes = detect_scenes(f"{d}/proxy.mp4", 8.0)
    assert len(scenes) == 2 and abs(scenes[1][0] - 4.0) < 0.3, scenes
    assert len(rms_windows(f"{d}/src.mp4")) == 16

    if os.path.exists(os.environ.get("MP_FACE_MODEL", "")):
        from vision import sample_faces
        assert len(sample_faces(f"{d}/proxy.mp4")) >= 15  # runs end to end; testsrc has no face
    else:
        print("face detection skipped (set MP_FACE_MODEL to the .tflite model to run it)")

    words = [W("Bonjour", .2, .7), W("tout", .8, 1.1), W("le", 1.15, 1.3), W("monde", 1.35, 1.9, emphasis=True)]
    track = [(t / 2, 0.3 + 0.05 * t) for t in range(12)]
    ff("-f", "lavfi", "-i", "sine=frequency=880:duration=30", "-y", f"{d}/music.m4a")
    out = render(f"{d}/src.mp4", 1.0, 7.0, words, {"preset": "bold"}, track, 1080, False, d, "hd.mp4", music=f"{d}/music.m4a")
    p = probe(out)
    assert (p["width"], p["height"]) == (1080, 1920) and abs(p["duration_s"] - 6) < 0.15 and p["has_audio"], p
    fps = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", out],
                         capture_output=True, text=True).stdout.strip()
    assert fps == "30/1", fps
    assert abs(loudness(out) + 14) < 1.5, loudness(out)

    free = render(f"{d}/src.mp4", 0.0, 3.0, words, {"preset": "clean", "position": "center"}, [], 720, True, d, "free.mp4")
    assert (probe(free)["width"], probe(free)["height"]) == (720, 1280)

    ff("-f", "lavfi", "-i", "testsrc=size=720x1280:rate=30:duration=3", "-f", "lavfi", "-i", "sine=duration=3",
       "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-y", f"{d}/portrait.mp4")
    pad = render(f"{d}/portrait.mp4", 0.0, 3.0, words, {}, [], 1080, False, d, "pad.mp4")
    assert (probe(pad)["width"], probe(pad)["height"]) == (1080, 1920)


if __name__ == "__main__":
    test_pure()
    with tempfile.TemporaryDirectory() as tmp:
        test_media(tmp)
    print("vision + render ok")
