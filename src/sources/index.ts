import { directUrl } from "./direct";
import { youtube } from "./youtube";
import type { SourceProvider } from "./types";

// Order matters: platform connectors first, the generic direct-file fallback last.
// Vimeo / Drive / Dropbox: see docs/SOURCES.md, added once their OAuth flows exist.
const providers: SourceProvider[] = [youtube, directUrl];

export const providerFor = (url: URL) => providers.find((p) => p.isConfigured() && p.canHandle(url))!;
export const providerById = (id: string) => providers.find((p) => p.id === id);
/** Platforms the landing/new-project screens may advertise in this deployment. */
export const advertisedPlatforms = () => providers.filter((p) => p.isConfigured() && p.importsMedia && p.id !== "direct").map((p) => p.platform);
