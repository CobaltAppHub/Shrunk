import { z } from "zod";

/** An explicit account id is required: never pick the first connected channel. */
export function e2eOptions(args: string[]) {
  const publishArgs = args.filter((a) => a.startsWith("--publish-youtube"));
  if (publishArgs.length > 1 || publishArgs.some((a) => !a.startsWith("--publish-youtube="))) {
    throw new Error("Utiliser --publish-youtube=<UUID du compte social de test>");
  }
  const accountId = publishArgs[0]?.slice("--publish-youtube=".length);
  if (accountId !== undefined && !z.uuid().safeParse(accountId).success) {
    throw new Error("--publish-youtube attend l'UUID d'un compte social de test");
  }
  const timeout = args.find((a) => a.startsWith("--timeout="))?.slice("--timeout=".length) ?? "30";
  const timeoutMin = Number(timeout);
  if (!Number.isFinite(timeoutMin) || timeoutMin <= 0 || timeoutMin > 120) throw new Error("--timeout doit être compris entre 0 et 120 minutes (0 exclu)");
  return { preflightOnly: args.includes("--preflight"), timeoutMin, youtubeAccountId: accountId };
}
