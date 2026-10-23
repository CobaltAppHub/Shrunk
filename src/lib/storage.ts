import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import { env } from "./env";

// R2 bucket in the EU jurisdiction; objects are private, access is via short-lived signed URLs only.
// Construct the client only when storage is actually used so public routes can
// import source providers without requiring private upload credentials.
const getS3 = () => new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});

// Keep the existing script-facing client export without constructing it during import.
export const s3 = new Proxy({} as S3Client, {
  get(_target, property: string | symbol) {
    const client = getS3();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/** Streams to R2 in 16 MB parts; at most ~64 MB in memory whatever the file size. */
export async function putStream(key: string, body: Readable, contentType: string) {
  await new Upload({ client: getS3(), params: { Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }, partSize: 16 * 1024 * 1024, queueSize: 4 }).done();
}

export const signedGetUrl = (key: string, expiresIn = 900, downloadName?: string) =>
  getSignedUrl(getS3(), new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    ...(downloadName ? { ResponseContentDisposition: `attachment; filename="${downloadName.replace(/[^\w.-]+/g, "_")}"` } : {}),
  }), { expiresIn });

export const signedPutUrl = (key: string, contentType: string, expiresIn = 3600) =>
  getSignedUrl(getS3(), new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, ContentType: contentType }), { expiresIn });

export async function getJson<T>(key: string): Promise<T> {
  const res = await getS3().send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  return JSON.parse(await res.Body!.transformToString("utf-8")) as T;
}

export async function headSize(key: string): Promise<number | null> {
  try {
    return (await getS3().send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }))).ContentLength ?? null;
  } catch {
    return null;
  }
}

// Workspace prefix on every key: keys are never shared or guessable across workspaces.
export const sourceKey = (workspaceId: string, assetId: string) => `ws/${workspaceId}/sources/${assetId}/source`;
export const transcriptKey = (workspaceId: string, assetId: string) => `ws/${workspaceId}/sources/${assetId}/transcript.json`;
export const previewKey = (workspaceId: string, clipId: string) => `ws/${workspaceId}/previews/${clipId}.mp4`;
export const visionKey = (workspaceId: string, assetId: string) => `ws/${workspaceId}/sources/${assetId}/vision.json`;
export const renderKey = (workspaceId: string, clipId: string, jobId: string) => `ws/${workspaceId}/renders/${clipId}/${jobId}.mp4`;

/** Inclusive byte range of an object (publishing uploads renders in chunks). */
export async function readRange(key: string, start: number, end: number): Promise<Uint8Array> {
  const res = await getS3().send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Range: `bytes=${start}-${end}` }));
  return res.Body!.transformToByteArray();
}
