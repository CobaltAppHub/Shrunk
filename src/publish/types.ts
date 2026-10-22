// Publishing to social platforms behind one interface, so an aggregator (Ayrshare, Upload-Post)
// can be plugged in as a fallback without touching the scheduler.
export type Platform = "tiktok" | "youtube" | "instagram";

export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date | null; scopes: string[] };
export type ConnectedAccount = Tokens & { externalId: string; displayName: string };

/** The rendered MP4, readable by byte range (TikTok, YouTube) or fetchable by URL (Instagram). */
export type VideoSource = {
  bytes: number;
  readRange: (start: number, end: number) => Promise<Uint8Array>; // inclusive end
  signedUrl: () => Promise<string>;
};

export type PublishInput = {
  accountExternalId: string; // platform user/channel id of the connected account
  video: VideoSource;
  title: string;
  caption: string;
  aiGenerated: boolean; // AI Act art. 50: platform flag + label in the caption
  options: PublishOptions;
};
export type PublishOptions = {
  privacy?: "public" | "unlisted" | "private"; // YouTube
  tiktokPrivacyLevel?: string; // TikTok direct post only; must be one of creator_info's options
};

export type PublishOutcome =
  | { status: "published"; externalPostId: string }
  | { status: "draft_sent"; externalPostId?: string } // TikTok inbox: the creator finishes in the app
  | { status: "processing"; pollRef: string }; // ask again with checkStatus

export type PublishErrorCode =
  | "auth_expired"    // token revoked or refresh failed → account marked expired, user alerted
  | "rate_limited"    // retry later (retryAfterS)
  | "quota_exceeded"  // daily platform quota: wait for the reset
  | "rejected"        // the platform refused this video or caption: no retry
  | "temporary";      // 5xx, network: retry with backoff

export class PublishError extends Error {
  constructor(public code: PublishErrorCode, public detail = "", public retryAfterS?: number) {
    super(`${code}${detail ? `: ${detail}` : ""}`);
  }
}

export interface PublisherProvider {
  platform: Platform;
  /** False when the app credentials are missing in this deployment: the platform is hidden. */
  isConfigured(): boolean;
  authorizeUrl(p: { state: string; redirectUri: string; codeChallenge: string }): string;
  exchangeCode(p: { code: string; redirectUri: string; codeVerifier: string }): Promise<ConnectedAccount>;
  refresh(tokens: Tokens): Promise<Tokens>;
  publish(input: PublishInput, tokens: Tokens): Promise<PublishOutcome>;
  checkStatus(pollRef: string, tokens: Tokens): Promise<PublishOutcome>;
}

export type Http = typeof fetch;
