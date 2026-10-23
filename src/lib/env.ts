import { envSchema } from "./env-schema";

type Env = ReturnType<typeof envSchema.parse>;

// `next build` imports route modules to collect page data on machines that do not
// have the runtime secrets (e.g. preview deploys). Validation still runs at runtime.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

export const env: Env = isBuildPhase
  ? (process.env as unknown as Env)
  : envSchema.parse(process.env);
