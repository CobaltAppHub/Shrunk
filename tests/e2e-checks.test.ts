import { describe, expect, it } from "vitest";
import { e2eOptions } from "../scripts/e2e-options";
import { assertHdRender, type Probe } from "../scripts/e2e-media";
import { Report } from "../scripts/report";

describe("E2E guardrails", () => {
  it("does not enable YouTube implicitly", () => {
    expect(e2eOptions([])).toEqual({ preflightOnly: false, timeoutMin: 30, youtubeAccountId: undefined });
    const id = crypto.randomUUID();
    expect(e2eOptions([`--publish-youtube=${id}`, "--preflight", "--timeout=10"]))
      .toEqual({ preflightOnly: true, timeoutMin: 10, youtubeAccountId: id });
  });
  it.each([["--publish-youtube"], ["--publish-youtube="], ["--publish-youtube=auto"], [`--publish-youtube=${crypto.randomUUID()}`, `--publish-youtube=${crypto.randomUUID()}`]])("rejects ambiguous channel selection: %s", (...args) => {
    expect(() => e2eOptions(args)).toThrow();
  });
  it.each(["0", "-1", "NaN", "Infinity", "121"])("rejects unusable timeout %s", (timeout) => {
    expect(() => e2eOptions([`--timeout=${timeout}`])).toThrow();
  });
  it("only disabled optional checks can be skipped in a complete core run", () => {
    const report = new Report("full");
    report.checks.push({ id: "youtube", section: "flow", title: "YouTube", status: "skip", optional: true });
    expect(report.verdict).toBe("PASS");
    report.checks.push({ id: "render", section: "flow", title: "Rendu", status: "skip" });
    expect(report.verdict).toBe("INCOMPLETE");
    report.checks.push({ id: "fail", section: "flow", title: "Échec", status: "fail", optional: true });
    expect(report.verdict).toBe("FAIL");
    expect(new Report("preflight").verdict).toBe("INCOMPLETE");
  });
});

describe("rendered media assertions", () => {
  const valid = (): Probe => ({ format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "30.02" }, streams: [{ codec_type: "video", width: 1080, height: 1920, avg_frame_rate: "30/1" }, { codec_type: "audio" }] });
  it("accepts only a measured MP4 at the expected duration and portrait resolution", () => {
    expect(assertHdRender(valid(), 30)).toEqual({ width: 1080, height: 1920, fps: 30, duration: 30.02 });
  });
  it("refuses landscape, 720p, silent, non-MP4, wrong fps, missing or wrong duration", () => {
    const landscape = valid(); landscape.streams![0]!.width = 1920; landscape.streams![0]!.height = 1080;
    const low = valid(); low.streams![0]!.width = 720; low.streams![0]!.height = 1280;
    const silent = valid(); silent.streams!.pop();
    const webm = valid(); webm.format!.format_name = "matroska,webm";
    const fps = valid(); fps.streams![0]!.avg_frame_rate = "0/0";
    const missing = valid(); delete missing.format!.duration;
    for (const probe of [landscape, low, silent, webm, fps, missing, {}]) expect(() => assertHdRender(probe, 30)).toThrow();
    expect(() => assertHdRender(valid(), 20)).toThrow();
  });
});
