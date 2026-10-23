import { envSchema } from "./env-schema";

// Validate configuration when a feature reads it, not while an unrelated public
// route is importing its module graph. This keeps the landing page and preview
// usable without weakening validation for database, auth, billing, or workers.
type Env = typeof envSchema._output;
type EnvKey = keyof Env;

export const env = new Proxy({} as Env, {
  get(_target, property: string | symbol) {
    if (typeof property !== "string" || !(property in envSchema.shape)) return undefined;
    const key = property as EnvKey;
    return envSchema.shape[key].parse(process.env[key]);
  },
});
