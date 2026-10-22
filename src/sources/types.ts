import type { ImportError, ImportErrorCode } from "./errors";

export type InspectStatus =
  | "supported"               // the media file itself can be fetched now
  | "unsupported"             // we cannot handle this link at all
  | "authentication_required" // fetchable once the user connects/grants access
  | "source_file_required"    // metadata only: the user must upload the file
  | "temporarily_unavailable"; // transient; never shown as "incompatible"

export type Inspection = {
  status: InspectStatus;
  provider: string;
  platform: string;
  canonicalUrl: string; // safe to display and store in clear (no query secrets)
  errorCode?: ImportErrorCode;
  externalVideoId?: string;
  title?: string;
  creatorName?: string;
  creatorUrl?: string;
  thumbnailUrl?: string;
  durationS?: number;  // indicative only, re-checked on the received file
  sizeBytes?: number;  // indicative only
};

export type IngestResult = { bytes: number; sha256: string; container: string };

export interface SourceProvider {
  id: string;
  platform: string;
  /** False when the connector's credentials are missing in this deployment: hidden in the UI. */
  isConfigured(): boolean;
  /** False for metadata-only connectors: they are never advertised as import sources. */
  importsMedia: boolean;
  canHandle(url: URL): boolean;
  inspect(url: URL, ctx: { signal?: AbortSignal }): Promise<Inspection>;
  ingest(url: URL, dest: { key: string; maxBytes: number }, ctx: { signal?: AbortSignal }): Promise<IngestResult>;
  normalizeError(err: unknown): ImportError;
}
