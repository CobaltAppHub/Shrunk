import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type Probe = {
  format?: { format_name?: string; duration?: string };
  streams?: { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string }[];
};

export function assertHdRender(probe: Probe, expectedDuration: number) {
  const video = probe.streams?.find((s) => s.codec_type === "video");
  const audio = probe.streams?.some((s) => s.codec_type === "audio");
  const duration = Number(probe.format?.duration);
  const [n, d] = (video?.avg_frame_rate ?? "0/1").split("/").map(Number);
  const fps = n! / d!;
  if (!probe.format?.format_name?.split(",").includes("mp4") || video?.width !== 1080 || video.height !== 1920 || !audio || !Number.isFinite(fps) || Math.abs(fps - 30) > 0.01 || !Number.isFinite(duration) || Math.abs(duration - expectedDuration) > 1) {
    throw new Error("Rendu invalide : MP4 1080×1920, 30 i/s, audio et durée de découpe attendus");
  }
  return { width: video.width, height: video.height, fps, duration };
}

/** Only a local file reaches ffprobe; signed R2 URLs never appear in its errors. */
export async function probeFile(file: string) {
  try {
    const { stdout } = await promisify(execFile)(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { timeout: 60_000, maxBuffer: 1024 * 1024 });
    return JSON.parse(stdout) as Probe;
  } catch {
    throw new Error("ffprobe indisponible ou fichier illisible : installer ffmpeg ou définir FFPROBE_PATH");
  }
}
