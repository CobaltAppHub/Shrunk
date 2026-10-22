// Each code has a localized message under `import.errors.<code>` in messages/*.json.
export const IMPORT_ERROR_CODES = [
  "invalid_link",
  "unsupported_source",
  "video_unavailable",
  "access_required",
  "retrieval_failed",
  "link_expired",
  "size_exceeded",
  "duration_exceeded",
  "quota_reached",
  "provider_unavailable",
  "not_a_video",
  "blocked_destination",
  "source_file_required",
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

// Retrying these cannot succeed; anything else may be transient.
const PERMANENT: ImportErrorCode[] = [
  "invalid_link", "unsupported_source", "video_unavailable", "access_required", "link_expired",
  "size_exceeded", "duration_exceeded", "quota_reached", "not_a_video", "blocked_destination", "source_file_required",
];

export class ImportError extends Error {
  constructor(public code: ImportErrorCode) {
    super(code);
  }
  get permanent() {
    return PERMANENT.includes(this.code);
  }
}
