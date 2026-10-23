import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
const { workspaceProjects } = await import("@/lib/studio");

describe("Studio projects", () => {
  it("lists only the caller's workspace, with real counts, latest first and a bounded result", async () => {
    const pg = new PGlite();
    try {
      for (const f of readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
        for (const stmt of readFileSync(`drizzle/${f}`, "utf8").split("--> statement-breakpoint")) await pg.exec(stmt);
      }
      const db = drizzle(pg, { schema }); state.db = db;
      await db.insert(schema.users).values([{ id: "a", email: "a@example.test" }, { id: "b", email: "b@example.test" }]);
      const [a, b] = await db.insert(schema.workspaces).values([{ name: "A", ownerId: "a" }, { name: "B", ownerId: "b" }]).returning();
      const [older, newer, foreign] = await db.insert(schema.projects).values([
        { workspaceId: a!.id, title: "Older", createdAt: new Date("2026-10-01T10:00:00Z") },
        { workspaceId: a!.id, title: "Newer", createdAt: new Date("2026-10-02T10:00:00Z") },
        { workspaceId: b!.id, title: "Private", createdAt: new Date("2026-10-03T10:00:00Z") },
      ]).returning();
      const clip = (projectId: string) => ({ projectId, startS: 0, endS: 20, score: 50, scoreReasons: {} });
      await db.insert(schema.clips).values([clip(newer!.id), clip(newer!.id), clip(foreign!.id)]);
      expect(await workspaceProjects(a!.id)).toEqual([
        { id: newer!.id, title: "Newer", status: "draft", clips: 2, createdAt: "2026-10-02T10:00:00.000Z" },
        { id: older!.id, title: "Older", status: "draft", clips: 0, createdAt: "2026-10-01T10:00:00.000Z" },
      ]);
      expect((await workspaceProjects(a!.id, 1)).map((p) => p.id)).toEqual([newer!.id]);
      expect((await workspaceProjects(b!.id)).map((p) => p.title)).toEqual(["Private"]);
      expect(await workspaceProjects(crypto.randomUUID())).toEqual([]);
    } finally { await pg.close(); }
  }, 15_000); // Includes a cold embedded-Postgres startup and all real migrations.
});
