"""Scene cuts, face positions and audio peaks for one source, plus the pure maths that turns them
into a 9:16 crop track. Heavy libraries are imported inside the functions that need them."""
import os
import subprocess

import numpy as np

from media import PROTOCOLS, run

FACE_MODEL = os.environ.get("MP_FACE_MODEL", "/models/blaze_face_short_range.tflite")
SAMPLE_FPS = 2  # face samples per second


def make_proxy(src: str, dst: str) -> None:
    """Small 10 fps proxy: analysis reads it locally instead of seeking in the remote source."""
    run(["ffmpeg", "-nostdin", "-v", "error", *PROTOCOLS, "-i", src, "-vf", "fps=10,scale=480:-2",
         "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-y", dst], timeout=3 * 3600)


def detect_scenes(path: str, duration: float) -> list:
    """[(start, end), ...] in seconds; one scene when nothing is cut."""
    from scenedetect import ContentDetector, detect

    scenes = [(s.get_seconds(), e.get_seconds()) for s, e in detect(path, ContentDetector(threshold=27.0))]
    return scenes or [(0.0, duration)]


def sample_faces(path: str) -> list:
    """[(t, [(cx, cy, w, h), ...]), ...] normalised to 0-1, SAMPLE_FPS samples per second."""
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python.core.base_options import BaseOptions
    from mediapipe.tasks.python.vision import FaceDetector, FaceDetectorOptions
    from mediapipe.tasks.python.vision.core.vision_task_running_mode import VisionTaskRunningMode

    opts = FaceDetectorOptions(base_options=BaseOptions(model_asset_path=FACE_MODEL),
                               running_mode=VisionTaskRunningMode.VIDEO, min_detection_confidence=0.5)
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 10
    step = max(1, round(fps / SAMPLE_FPS))
    out, i = [], 0
    with FaceDetector.create_from_options(opts) as det:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if i % step == 0:
                h, w = frame.shape[:2]
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                res = det.detect_for_video(image, int(i / fps * 1000))
                faces = [((d.bounding_box.origin_x + d.bounding_box.width / 2) / w,
                          (d.bounding_box.origin_y + d.bounding_box.height / 2) / h,
                          d.bounding_box.width / w, d.bounding_box.height / h) for d in res.detections]
                out.append((round(i / fps, 2), faces))
            i += 1
    cap.release()
    return out


def rms_windows(src: str, hop: float = 0.5) -> np.ndarray:
    """RMS of the 16 kHz mono signal per `hop` seconds."""
    pcm = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", *PROTOCOLS, "-i", src, "-vn", "-ac", "1", "-ar", "16000",
                          "-f", "s16le", "-"], capture_output=True, timeout=3 * 3600).stdout
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
    n = int(16000 * hop)
    x = x[: len(x) // n * n].reshape(-1, n) if len(x) >= n else np.zeros((0, n))
    return np.sqrt((x ** 2).mean(axis=1)) if len(x) else np.zeros(0)


# ── Pure functions (tested in test_vision.py) ────────────────────────────────

def peaks_from_rms(rms: np.ndarray, hop: float = 0.5, z: float = 2.0, gap: float = 3.0) -> list:
    """Times of loud moments (laughter, applause, raised voice): z-score above `z`, at least `gap` s apart."""
    if len(rms) < 4 or rms.std() == 0:
        return []
    score = (rms - rms.mean()) / rms.std()
    out = []
    for i in np.argsort(-score):
        if score[i] < z:
            break
        t = round(float(i * hop), 2)
        if all(abs(t - p) >= gap for p in out):
            out.append(t)
    return sorted(out)


def crop_track(samples: list, scenes: list, src_w: int, src_h: int, alpha: float = 0.25) -> list:
    """[(t, x), ...]: horizontal centre (0-1) of a 9:16 window that follows the main face.

    ponytail: "main face" = largest face in the frame, a proxy for the active speaker. Upgrade path:
    match WhisperX speaker turns to face tracks (lip motion) when multi-speaker podcasts matter.
    Smoothing never crosses a scene cut, so the frame jumps with the edit instead of panning across it.
    """
    half = (src_h * 9 / 16) / src_w / 2  # half the crop width, as a fraction of the source width
    if half >= 0.5:
        return []  # source already 9:16 or narrower: nothing to crop horizontally
    lo, hi = half, 1 - half
    track = []
    for s_start, s_end in scenes:
        inside = [(t, faces) for t, faces in samples if s_start <= t < s_end]
        xs = [max(faces, key=lambda f: f[2] * f[3])[0] if faces else None for _, faces in inside]
        seen = [x for x in xs if x is not None]
        held = float(np.median(seen)) if seen else 0.5  # no face in the whole scene: centre
        cur = None
        for (t, _), x in zip(inside, xs):
            target = held if x is None else x
            held = target
            cur = target if cur is None else cur + alpha * (target - cur)
            track.append((t, round(min(hi, max(lo, cur)), 4)))
    return track
