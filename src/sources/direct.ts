import { putStream } from "@/lib/storage";
import { ImportError } from "./errors";
import { guardedBody } from "./pipe";
import { safeFetch, sniffVideo } from "./safe-fetch";
import type { Inspection, SourceProvider } from "./types";

// Query params that usually carry a credential: a 401/403 on such a link is an expired link, not a private video.
const SIGNED = /^(x-amz-|x-goog-|signature$|sig$|token$|expires$|se$|sp$|sv$|st$)/i;
const isSigned = (u: URL) => [...u.searchParams.keys()].some((k) => SIGNED.test(k));
const canonical = (u: URL) => `${u.origin}${u.pathname}`;

function statusError(status: number, u: URL): ImportError {
  if (status === 401 || status === 403) return new ImportError(isSigned(u) ? "link_expired" : "access_required");
  if (status === 404 || status === 410) return new ImportError("video_unavailable");
  if (status === 429 || status >= 500) return new ImportError("provider_unavailable");
  return new ImportError("retrieval_failed");
}

export const directUrl: SourceProvider = {
  id: "direct",
  platform: "web",
  isConfigured: () => true,
  importsMedia: true,
  canHandle: () => true, // fallback: registered last

  async inspect(url, { signal }) {
    const base = { provider: "direct", platform: "web", canonicalUrl: canonical(url) };
    try {
      // A 1 KB range read tells us reachability, size and the real container in one request.
      const { res } = await safeFetch(url, { headers: { range: "bytes=0-1023" }, signal });
      if (res.status !== 200 && res.status !== 206) throw statusError(res.status, url);
      const buf = new Uint8Array(await res.arrayBuffer()).subarray(0, 1024);
      if (!sniffVideo(buf)) return { ...base, status: "unsupported", errorCode: "not_a_video" };
      const total = res.headers.get("content-range")?.split("/")[1] ?? res.headers.get("content-length");
      return {
        ...base,
        status: "supported",
        title: decodeURIComponent(url.pathname.split("/").pop() || url.hostname),
        creatorName: url.hostname,
        sizeBytes: total && total !== "*" ? Number(total) : undefined,
      } satisfies Inspection;
    } catch (e) {
      const err = directUrl.normalizeError(e);
      const status = err.code === "provider_unavailable" ? "temporarily_unavailable"
        : err.code === "access_required" ? "authentication_required" : "unsupported";
      return { ...base, status, errorCode: err.code };
    }
  },

  async ingest(url, dest, { signal }) {
    try {
      const { res } = await safeFetch(url, { signal });
      if (res.status !== 200) throw statusError(res.status, url);
      const { stream, result } = guardedBody(res, dest.maxBytes);
      await putStream(dest.key, stream, "application/octet-stream");
      return result();
    } catch (e) {
      throw directUrl.normalizeError(e);
    }
  },

  normalizeError(e) {
    if (e instanceof ImportError) return e;
    const cause = (e as { cause?: unknown })?.cause;
    if (cause instanceof ImportError) return cause; // undici wraps lookup errors
    const code = (e as { code?: string; name?: string })?.code ?? (cause as { code?: string })?.code;
    if (code === "ENOTFOUND") return new ImportError("invalid_link");
    return new ImportError("provider_unavailable"); // timeouts, resets: transient
  },
};
