// Run report written after every E2E run, for humans and for Codex (see AGENTS.md).
// Never contains secret values: only variable names, statuses, ids and measured numbers.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

export type Status = "pass" | "fail" | "warn" | "skip";
export type Check = {
  id: string;
  section: "preflight" | "flow" | "security";
  title: string;
  status: Status;
  ms?: number;
  detail?: string;
  /** Where to look when it fails: repo paths or doc anchors. */
  files?: string[];
  /** A deliberately disabled optional extension does not make the core run incomplete. */
  optional?: boolean;
};

export class Report {
  readonly started = new Date();
  readonly checks: Check[] = [];
  readonly facts: Record<string, string | number | boolean | null> = {};

  constructor(readonly mode: "preflight" | "full") {}

  add(c: Check) {
    this.checks.push(c);
    const icon = { pass: "PASS", fail: "FAIL", warn: "WARN", skip: "SKIP" }[c.status];
    console.log(`[${icon}] ${c.title}${c.detail ? ` — ${c.detail}` : ""}`);
    return c.status;
  }

  /** Times an async check; a thrown error becomes a failed check with its message. */
  async run(c: Omit<Check, "status" | "ms">, fn: () => Promise<{ status?: Status; detail?: string } | void>): Promise<Status> {
    const t0 = Date.now();
    try {
      const r = (await fn()) ?? {};
      return this.add({ ...c, status: r.status ?? "pass", detail: r.detail ?? c.detail, ms: Date.now() - t0 });
    } catch (e) {
      return this.add({ ...c, status: "fail", detail: errorText(e), ms: Date.now() - t0 });
    }
  }

  get verdict(): "PASS" | "FAIL" | "INCOMPLETE" {
    if (this.checks.some((c) => c.status === "fail")) return "FAIL";
    if (this.mode === "preflight" || this.checks.some((c) => c.status === "skip" && !c.optional)) return "INCOMPLETE";
    return "PASS";
  }

  write(dir = "reports/e2e"): string {
    mkdirSync(dir, { recursive: true });
    const stamp = this.started.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const md = this.markdown();
    writeFileSync(`${dir}/${stamp}.md`, md);
    writeFileSync(`${dir}/${stamp}.json`, JSON.stringify({ verdict: this.verdict, mode: this.mode, started: this.started, commit: git(), facts: this.facts, checks: this.checks }, null, 2));
    writeFileSync(`${dir}/latest.md`, md);
    return `${dir}/${stamp}.md`;
  }

  markdown(): string {
    const failed = this.checks.filter((c) => c.status === "fail");
    const warned = this.checks.filter((c) => c.status === "warn");
    const row = (c: Check) => `| ${c.status.toUpperCase()} | ${c.title} | ${c.ms != null ? `${(c.ms / 1000).toFixed(1)} s` : ""} | ${(c.detail ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`;
    const section = (s: Check["section"], title: string) => {
      const rows = this.checks.filter((c) => c.section === s);
      return rows.length ? `## ${title}\n\n| Statut | Vérification | Durée | Détail |\n|---|---|---|---|\n${rows.map(row).join("\n")}\n` : "";
    };
    const todo = [...failed, ...warned].map((c) =>
      `- [ ] **${c.status === "fail" ? "Échec" : "Avertissement"} — ${c.title}** (\`${c.id}\`)\n  - Constat : ${c.detail ?? "aucun détail"}\n  - À regarder : ${(c.files ?? ["docs/E2E.md"]).map((f) => `\`${f}\``).join(", ")}`,
    ).join("\n");

    return `# Rapport E2E — ${this.verdict}

- Date : ${this.started.toISOString()}
- Mode : ${this.mode === "preflight" ? "préflight seul (aucun service payant appelé)" : "parcours complet"}
- Commit : \`${git()}\`
- Durée totale : ${((Date.now() - this.started.getTime()) / 1000).toFixed(0)} s
- Résultat : ${this.checks.filter((c) => c.status === "pass").length} OK, ${failed.length} échec(s), ${warned.length} avertissement(s), ${this.checks.filter((c) => c.status === "skip").length} non exécuté(s)

${section("preflight", "Préflight (services et configuration)")}
${section("flow", "Parcours URL → import → transcription → extraits → aperçus → rendu ; YouTube privé en option")}
${section("security", "Contrôles de sécurité")}
## Mesures

${Object.keys(this.facts).length ? Object.entries(this.facts).map(([k, v]) => `- ${k} : ${v}`).join("\n") : "_Aucune (parcours non exécuté)._"}

## Pour Codex

${todo || "Rien à corriger dans ce run."}

Règles : ne pas inventer de résultat ni affaiblir une assertion pour faire passer le run ; corriger la cause, relancer \`pnpm e2e\`, et comparer avec ce rapport. Contexte du dépôt : \`AGENTS.md\`.
`;
  }
}

export function errorText(e: unknown): string {
  const err = e as { message?: string; code?: string; cause?: { code?: string; message?: string } };
  return [err?.code, err?.message, err?.cause?.code ?? err?.cause?.message].filter(Boolean).join(" / ").slice(0, 400) || String(e);
}

function git(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return dirty ? `${sha} (modifications non commitées)` : sha;
  } catch {
    return "inconnu";
  }
}
