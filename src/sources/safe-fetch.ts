import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch, type Response } from "undici";
import { ImportError } from "./errors";

// Everything that is not the public internet. IPv4-mapped IPv6 (::ffff:a.b.c.d) is matched by BlockList itself.
export const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, prefix, "ipv6");

export const isBlockedIp = (ip: string) => {
  const v = isIP(ip);
  return v === 0 || blocked.check(ip, v === 4 ? "ipv4" : "ipv6");
};

/**
 * DNS lookup used by the socket itself: the address we validate is the address we connect to,
 * so DNS rebinding between "check" and "connect" is impossible.
 */
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  cb: (err: Error | null, address?: string | LookupAddress[], family?: number) => void,
) {
  dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) return cb(new ImportError("blocked_destination"));
    if (options.all) return cb(null, addrs);
    cb(null, addrs[0]!.address, addrs[0]!.family);
  });
}

const agent = new Agent({
  connect: { lookup: guardedLookup as never, timeout: 10_000 },
  headersTimeout: 15_000,
  bodyTimeout: 60_000, // max silence between chunks, not total duration
  connections: 32,
});

const prod = process.env.NODE_ENV === "production";

/** Syntactic checks done before any network I/O. Throws ImportError("invalid_link" | "blocked_destination"). */
export function validateUrl(raw: string | URL): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ImportError("invalid_link"); }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && !prod)) throw new ImportError("invalid_link");
  if (u.username || u.password) throw new ImportError("invalid_link");
  if (u.port && !["443", "80"].includes(u.port)) throw new ImportError("blocked_destination");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  // IP literals never reach the lookup hook, so they are checked here.
  if (isIP(host) && isBlockedIp(host)) throw new ImportError("blocked_destination");
  if (!isIP(host) && (!host.includes(".") || /\.(local|localhost|internal|lan|home|corp)$/i.test(host))) {
    throw new ImportError("blocked_destination");
  }
  return u;
}

const SECRET_HEADERS = ["authorization", "cookie", "proxy-authorization"];

/** fetch with SSRF protection, per-hop validation and no credential leakage across origins. */
export async function safeFetch(
  raw: string | URL,
  init: { method?: "GET" | "HEAD"; headers?: Record<string, string>; signal?: AbortSignal; maxRedirects?: number } = {},
): Promise<{ res: Response; url: URL }> {
  let url = validateUrl(raw);
  let headers = { ...init.headers };
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, { method: init.method ?? "GET", headers, redirect: "manual", dispatcher: agent, signal: init.signal });
    if (![301, 302, 303, 307, 308].includes(res.status)) return { res, url };
    await res.body?.cancel();
    if (hop >= (init.maxRedirects ?? 5)) throw new ImportError("retrieval_failed");
    const location = res.headers.get("location");
    if (!location) throw new ImportError("retrieval_failed");
    const next = validateUrl(new URL(location, url));
    if (next.origin !== url.origin) {
      headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !SECRET_HEADERS.includes(k.toLowerCase())));
    }
    url = next;
  }
}

/** Container detection from magic bytes; the extension and Content-Type are not trusted. */
export function sniffVideo(b: Uint8Array): "mp4" | "matroska" | "avi" | "mpegts" | "flv" | null {
  const ascii = (from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));
  if (b.length >= 12 && ascii(4, 4) === "ftyp") return "mp4"; // mp4, mov, m4v, 3gp
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "matroska"; // mkv, webm
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "AVI ") return "avi";
  if (b.length >= 3 && ascii(0, 3) === "FLV") return "flv";
  if (b.length >= 189 && b[0] === 0x47 && b[188] === 0x47) return "mpegts";
  return null;
}
