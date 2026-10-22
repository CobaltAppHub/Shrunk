import { Response } from "undici";
import { describe, expect, it } from "vitest";
import { ImportError } from "@/sources/errors";
import { guardedBody } from "@/sources/pipe";
import { isBlockedIp, safeFetch, sniffVideo, validateUrl } from "@/sources/safe-fetch";
import { youtubeId } from "@/sources/youtube";

const code = async (p: Promise<unknown> | (() => unknown)) => {
  try { await (typeof p === "function" ? p() : p); } catch (e) { return e instanceof ImportError ? e.code : (e as { cause?: ImportError }).cause?.code ?? String(e); }
  return "ok";
};

describe("IP blocklist", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe", "2002:7f00:1::",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe("URL validation", () => {
  it.each([
    ["not a url", "invalid_link"],
    ["ftp://example.com/a.mp4", "invalid_link"],
    ["file:///etc/passwd", "invalid_link"],
    ["https://user:pass@example.com/a.mp4", "invalid_link"],
    ["https://127.0.0.1/a.mp4", "blocked_destination"],
    ["https://[::1]/a.mp4", "blocked_destination"],
    ["https://[::ffff:7f00:1]/a.mp4", "blocked_destination"],
    ["https://2130706433/a.mp4", "blocked_destination"], // decimal 127.0.0.1, normalised by URL()
    ["https://0x7f.1/a.mp4", "blocked_destination"],
    ["https://169.254.169.254/latest/meta-data", "blocked_destination"],
    ["https://localhost/a.mp4", "blocked_destination"],
    ["https://metadata.google.internal/", "blocked_destination"],
    ["https://example.com:6379/", "blocked_destination"],
  ])("%s → %s", async (url, expected) => expect(await code(() => validateUrl(url))).toBe(expected));

  it("accepts a public https URL", () => expect(validateUrl("https://example.com/v.mp4").hostname).toBe("example.com"));
});

describe("connection-time DNS check (rebinding)", () => {
  // Public DNS name that resolves to 127.0.0.1: passes syntax checks, must be refused at connect time.
  it("refuses a hostname resolving to loopback", async () => {
    expect(await code(safeFetch("https://127.0.0.1.nip.io/x.mp4", { signal: AbortSignal.timeout(10_000) }))).toBe("blocked_destination");
  }, 15_000);
});

describe("content sniffing", () => {
  const mp4 = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypmp42"), 0, 0, 0, 0]);
  it("recognises containers by magic bytes", () => {
    expect(sniffVideo(mp4)).toBe("mp4");
    expect(sniffVideo(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]))).toBe("matroska");
    expect(sniffVideo(Buffer.from("<!doctype html><html>"))).toBeNull();
  });

  const stream = async (bytes: Uint8Array, max: number, headers: Record<string, string> = {}) => {
    const { stream, result } = guardedBody(new Response(bytes, { headers }), max);
    await stream.toArray();
    return result();
  };
  it("passes a real video and hashes it", async () => {
    const r = await stream(new Uint8Array([...mp4, ...new Uint8Array(500)]), 10_000);
    expect(r).toMatchObject({ bytes: 516, container: "mp4" });
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("rejects an HTML page named .mp4", async () => {
    expect(await code(stream(Buffer.from("<html>".repeat(100)), 10_000))).toBe("not_a_video");
  });
  it("enforces the byte limit while streaming, even with a lying Content-Length", async () => {
    expect(await code(stream(new Uint8Array([...mp4, ...new Uint8Array(5000)]), 1000))).toBe("size_exceeded");
    expect(await code(() => guardedBody(new Response("x", { headers: { "content-length": "999999" } }), 1000))).toBe("size_exceeded");
  });
});

describe("YouTube link parsing", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/@channel", null],
  ])("%s", (url, id) => expect(youtubeId(new URL(url))).toBe(id));
});
