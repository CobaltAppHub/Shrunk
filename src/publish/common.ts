import { PublishError } from "./types";

/** Maps an HTTP failure to a publish error the scheduler knows how to handle. */
export async function failFrom(res: Response, context: string): Promise<never> {
  const body = await res.text().catch(() => "");
  const detail = `${context} ${res.status} ${body.slice(0, 300)}`;
  const retryAfter = Number(res.headers.get("retry-after")) || undefined;
  if (res.status === 401) throw new PublishError("auth_expired", detail);
  if (res.status === 429) throw new PublishError("rate_limited", detail, retryAfter ?? 60);
  if (res.status >= 500) throw new PublishError("temporary", detail, retryAfter);
  if (/quota/i.test(body)) throw new PublishError("quota_exceeded", detail);
  if (/invalid_grant|token.*(expired|invalid)|scope_not_authorized/i.test(body)) throw new PublishError("auth_expired", detail);
  throw new PublishError("rejected", detail);
}

export async function json<T>(res: Response, context: string): Promise<T> {
  if (!res.ok) await failFrom(res, context);
  return (await res.json()) as T;
}

export const expiresIn = (seconds: number | undefined) => (seconds ? new Date(Date.now() + seconds * 1000) : null);
