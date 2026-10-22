import { ImportError } from "./errors";
import { safeFetch } from "./safe-fetch";
import type { SourceProvider } from "./types";

const HOSTS = /^(www\.|m\.|music\.)?(youtube\.com|youtube-nocookie\.com)$|^youtu\.be$/i;

export function youtubeId(u: URL): string | null {
  if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
  const v = u.searchParams.get("v");
  if (v) return v;
  const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{6,})/);
  return m?.[2] ?? null;
}

/**
 * Metadata only. YouTube's ToS forbid downloading content except where the Service explicitly
 * permits it or with YouTube's prior written permission, and the Data API has no media download
 * endpoint. Until a compliant mechanism exists, the user uploads the file and we keep the provenance.
 */
export const youtube: SourceProvider = {
  id: "youtube",
  platform: "youtube",
  isConfigured: () => true,
  importsMedia: false,
  canHandle: (u) => HOSTS.test(u.hostname),

  async inspect(url, { signal }) {
    const id = youtubeId(url);
    const canonicalUrl = id ? `https://www.youtube.com/watch?v=${id}` : `${url.origin}${url.pathname}`;
    const base = { provider: "youtube", platform: "youtube", canonicalUrl, externalVideoId: id ?? undefined };
    if (!id) return { ...base, status: "unsupported", errorCode: "invalid_link" };
    try {
      const { res } = await safeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonicalUrl)}`, { signal });
      if (res.status === 401 || res.status === 403 || res.status === 404) return { ...base, status: "unsupported", errorCode: "video_unavailable" };
      if (!res.ok) return { ...base, status: "temporarily_unavailable", errorCode: "provider_unavailable" };
      const o = (await res.json()) as { title?: string; author_name?: string; author_url?: string; thumbnail_url?: string };
      return { ...base, status: "source_file_required", errorCode: "source_file_required", title: o.title, creatorName: o.author_name, creatorUrl: o.author_url, thumbnailUrl: o.thumbnail_url };
    } catch {
      return { ...base, status: "temporarily_unavailable", errorCode: "provider_unavailable" };
    }
  },

  async ingest() {
    throw new ImportError("source_file_required");
  },

  normalizeError: (e) => (e instanceof ImportError ? e : new ImportError("provider_unavailable")),
};
