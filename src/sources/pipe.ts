import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import type { Response } from "undici";
import { ImportError } from "./errors";
import { sniffVideo } from "./safe-fetch";
import type { IngestResult } from "./types";

/**
 * Wraps a response body in a guard that enforces the byte limit while streaming,
 * verifies the container from the first bytes and hashes the content.
 */
export function guardedBody(res: Response, maxBytes: number) {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (declared > maxBytes) throw new ImportError("size_exceeded");
  if (!res.body) throw new ImportError("retrieval_failed");

  const hash = createHash("sha256");
  let bytes = 0;
  let head = Buffer.alloc(0);
  let container: string | null = null;
  const guard = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > maxBytes) return cb(new ImportError("size_exceeded"));
      if (!container) {
        head = Buffer.concat([head, chunk]);
        container = sniffVideo(head);
        if (!container && head.length >= 189) return cb(new ImportError("not_a_video"));
      }
      hash.update(chunk);
      cb(null, chunk);
    },
    flush(cb) {
      if (!container) container = sniffVideo(head);
      cb(container ? null : new ImportError("not_a_video"));
    },
  });
  const src = Readable.fromWeb(res.body as never);
  src.on("error", (e) => guard.destroy(e)); // .pipe() does not forward source errors
  const stream = src.pipe(guard);
  return { stream, result: (): IngestResult => ({ bytes, sha256: hash.digest("hex"), container: container! }) };
}
