"""Modal app: an authenticated submit endpoint spawns GPU/CPU jobs, which report back by signed callback.

The sandbox holds no storage or database credentials. It only receives short-lived signed R2 URLs
(GET for the source, PUT for outputs) and the callback secret.

Deploy: modal deploy worker/app.py   (secret "shrunk-worker" must exist, see README)
"""
import hashlib
import hmac
import json
import os
import tempfile
import time
import urllib.request

import modal

app = modal.App("shrunk-worker")
models = modal.Volume.from_name("shrunk-models", create_if_missing=True)
# WORKER_TOKEN, CALLBACK_SECRET, CALLBACK_URL; optional HF_TOKEN, GPU_USD_PER_S, CPU_USD_PER_S
secrets = [modal.Secret.from_name("shrunk-worker")]

cpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("fastapi[standard]")
    .add_local_python_source("media")
)
gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("whisperx==3.4.2")
    .env({"HF_HOME": "/models/hf", "TORCH_HOME": "/models/torch"})
    .add_local_python_source("media", "transcribe")
)


def sign(secret: str, ts: str, body: bytes) -> str:
    return hmac.new(secret.encode(), ts.encode() + b"." + body, hashlib.sha256).hexdigest()


def callback(payload: dict) -> None:
    body = json.dumps(payload).encode()
    ts = str(int(time.time()))
    req = urllib.request.Request(os.environ["CALLBACK_URL"], data=body, method="POST", headers={
        "content-type": "application/json",
        "x-shrunk-timestamp": ts,
        "x-shrunk-signature": sign(os.environ["CALLBACK_SECRET"], ts, body),
    })
    for attempt in range(5):
        try:
            urllib.request.urlopen(req, timeout=30).read()
            return
        except Exception:
            time.sleep(2 ** attempt)
    raise RuntimeError("callback_failed")


def put(path: str, url: str, content_type: str) -> None:
    with open(path, "rb") as f:
        req = urllib.request.Request(url, data=f.read(), method="PUT", headers={"content-type": content_type})
        urllib.request.urlopen(req, timeout=300).read()


def cost(seconds: float, env_key: str):
    rate = os.environ.get(env_key)
    return round(seconds * float(rate), 4) if rate else None  # unknown rather than invented


@app.function(image=gpu_image, gpu="L4", secrets=secrets, volumes={"/models": models}, timeout=3 * 3600, region="eu")
def run_transcribe(req: dict) -> None:
    from media import MediaError, extract_audio, probe
    from transcribe import transcribe

    t0 = time.time()
    head = {"kind": "transcribe", "ref": req["ref"]}
    try:
        info = probe(req["source_url"])
        if info["duration_s"] > req["max_duration_s"]:
            raise MediaError("duration_exceeded")
        if info["duration_s"] > req["quota_remaining_s"]:
            raise MediaError("quota_reached")
        if not info["has_audio"]:
            raise MediaError("no_audio")
        with tempfile.TemporaryDirectory() as d:
            extract_audio(req["source_url"], f"{d}/a.wav")
            transcript = transcribe(f"{d}/a.wav")
            with open(f"{d}/t.json", "w", encoding="utf-8") as f:
                json.dump(transcript, f, ensure_ascii=False)
            put(f"{d}/t.json", req["transcript_put_url"], "application/json")
        models.commit()  # keep downloaded weights for the next cold start
        callback({**head, "ok": True, "duration_s": info["duration_s"], "language": transcript["language"],
                  "cost_usd": cost(time.time() - t0, "GPU_USD_PER_S")})
    except MediaError as e:
        callback({**head, "ok": False, "error_code": e.code})
    except Exception:
        callback({**head, "ok": False, "error_code": "worker_failed"})
        raise


@app.function(image=cpu_image, cpu=4, secrets=secrets, timeout=1800, region="eu")
def run_previews(req: dict) -> None:
    from media import make_preview

    t0 = time.time()
    done, failed = [], []
    with tempfile.TemporaryDirectory() as d:
        for c in req["clips"]:
            try:
                make_preview(req["source_url"], c["start"], c["end"], f"{d}/p.mp4")
                put(f"{d}/p.mp4", c["put_url"], "video/mp4")
                done.append(c["id"])
            except Exception:
                failed.append(c["id"])
    callback({"kind": "previews", "ref": req["ref"], "ok": True, "done": done, "failed": failed,
              "cost_usd": cost(time.time() - t0, "CPU_USD_PER_S")})


@app.function(image=cpu_image, secrets=secrets, region="eu")
@modal.asgi_app()
def api():
    """POST /jobs {kind: "transcribe"|"previews", ...} with Authorization: Bearer WORKER_TOKEN → 202."""
    from fastapi import FastAPI, Header, HTTPException

    web = FastAPI()

    @web.post("/jobs", status_code=202)
    def jobs(body: dict, authorization: str = Header("")):
        if not hmac.compare_digest(authorization, f"Bearer {os.environ['WORKER_TOKEN']}"):
            raise HTTPException(status_code=401)
        fn = {"transcribe": run_transcribe, "previews": run_previews}.get(body.get("kind"))
        if not fn:
            raise HTTPException(status_code=400)
        call = fn.spawn(body)
        return {"call_id": call.object_id}

    return web
