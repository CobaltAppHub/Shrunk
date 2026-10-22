# Session 2026-10-23 — J2 bis (vision) and J3 core (editor + paid 9:16 render), without API keys

No E2E run this session: the keys are still missing, so the latest report is unchanged ([reports/e2e/latest.md](../e2e/latest.md)). Every check below runs locally.

## What changed

| File | Change |
|---|---|
| `worker/vision.py` | New. 10 fps proxy (ffmpeg with the protocol whitelist), scene cuts (PySceneDetect `ContentDetector`), faces at 2 samples/s (MediaPipe Tasks `FaceDetector` in VIDEO mode), audio RMS peaks. Pure functions: `crop_track` (largest face, gap hold, smoothing reset at every cut, clamped inside the frame) and `peaks_from_rms`. |
| `worker/render.py` | New. 9:16 crop driven by `sendcmd` keyframes, or padding for sources already 9:16 or narrower. Word-by-word ASS captions: 3 words/line, the active word highlighted, user text escaped. Watermark on the free plan. Optional music ducked under the voice (`sidechaincompress`, -18 dB bed). `loudnorm` to -14 LUFS. H.264 30 fps, 1080x1920 or 720x1280. |
| `worker/app.py` | New `run_vision` (CPU 4) and `run_render` (CPU 8, 15 min). The image adds `fonts-inter`, scenedetect, opencv, `mediapipe==1.1.1` and the official `blaze_face_short_range.tflite` model, downloaded at build time. |
| `worker/test_render.py`, `worker/requirements-dev.txt` | New self-check, also run in CI. |
| `src/lib/edit-state.ts` | New. Zod schema of the editor state, defaults, server-side trim validation, `renderSpec(plan)` (resolution and watermark decided by the plan, never by the client), `renderPayload`. |
| `src/inngest/analyze.ts` | Vision job dispatched after transcription and run in parallel with clip selection. The result goes to `source_assets.vision`. A failed vision step is not fatal: the crop falls back to centred. |
| `src/inngest/render.ts` | New. Paid render: dispatch, wait on the job row, then **capture only if the MP4 exists in R2**. Otherwise it releases the credit and sends the "credits returned" email. Works together with the existing 15-minute sweeper. |
| `src/app/api/worker/callback/route.ts`, `src/lib/worker.ts` | Accept the `vision` (keyed by asset) and `render` (keyed by job id) callbacks. |
| `…/projects/[id]/clips/[clipId]/{page,editor,actions}.tsx` | New clip editor:<br>• trim, with "start/end here" buttons<br>• word-by-word caption editing (Enter moves to the next word, focusing a word seeks the video) and emphasis toggles<br>• style, crop mode, live caption overlay on the preview<br>• render panel showing the cost before the action, the balance, then status and download<br>• honest note that there is no licensed music yet<br>Autosaves, and the server re-validates. |
| `drizzle/0002_j3_render.sql` | `source_assets.vision`, job type `vision`. |
| `messages/*.json` | `editor.*` in 5 languages (key parity checked). |

## Verified

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (81/81, of which 7 new editor and render-payload tests). `next build` passes.
- `python -I worker/test_media.py` passes.
- `python -I worker/test_render.py` (venv with scenedetect 0.6.4, opencv 5.0, mediapipe 1.1.1) passes:
  - a synthetic hard cut at 4 s is detected;
  - RMS windows are correct;
  - the HD render with moving crop and music is 1080x1920 at 30 fps, 6.0 s, loudness within ±1.5 LU of -14;
  - free render is 720x1280; a portrait source gets padded.
- Visual check of one rendered frame: uppercase captions with the active word highlighted, watermark bottom-right, crop window moving between the two frames.

## Not verified

- **MediaPipe face detection itself**: the model is downloaded in the Modal image, not locally. The face path of `test_render.py` runs only when `MP_FACE_MODEL` is set. The crop maths is tested with synthetic detections.
- **The editor UI in a browser**: it needs a database session. Only its types and its build were checked.
- **Anything on Modal, R2, Claude or Postgres**: keys still missing.
- **The E2E flow does not include a paid render yet.**

## Open risks

- "Main face = largest face" is a proxy for the active speaker (`ponytail:` comment in `crop_track`). Two-person podcasts with the same face size may switch speaker poorly.
- `loudnorm` single pass: about ±1 LU.
- The editor allows trimming inside the candidate's range only (the 480p preview covers just that range).

## Next steps

1. Once keys exist: `pnpm db:migrate`, redeploy the worker (`modal deploy worker/app.py`), then `pnpm e2e`.
2. Extend `scripts/e2e.ts` with one paid render of the best clip. To do so, move the core of `requestRender` into `src/lib/` like `startLinkImport`. Assert capture, an MP4 of 1080x1920, and no double charge on replay.
3. J3 rest: visual timeline, brand kits (Pro), licensed music library, emoji. Then J4 (publishing).
