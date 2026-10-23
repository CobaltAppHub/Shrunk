import { describe, expect, it } from "vitest";
import fr from "../messages/fr.json";
import en from "../messages/en.json";
import es from "../messages/es.json";
import it_ from "../messages/it.json";
import de from "../messages/de.json";
import { CREDIT_COSTS, PLANS } from "@/lib/pricing";
import { DEMO } from "@/lib/demo";
import { DEMO_CLIPS, availableDemoClips, formatHMS, validateDemoClips, type DemoClip } from "@/lib/landing-demo";
import { PAID_PLAN_IDS, hourVideosPerMonth, minimalPlan } from "@/lib/landing-math";

const leafKeys = (o: unknown, prefix = ""): string[] =>
  o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k)) : [prefix];

describe("landing i18n", () => {
  const locales = { en, es, it: it_, de };
  it.each(Object.entries(locales))("%s has every landing and legal key of fr", (_name, messages) => {
    const expected = [...leafKeys(fr.landing, "landing"), ...leafKeys(fr.legal, "legal")].sort();
    const actual = [...leafKeys(messages.landing, "landing"), ...leafKeys(messages.legal, "legal")].sort();
    expect(actual).toEqual(expected);
  });

  it("uses the exact French copy for the offer and the footer", () => {
    expect(fr.landing.hero.cta).toBe("Essayer 7 jours pour 1 €");
    expect(fr.landing.hero.reassurance).toBe("7 jours pour 1 € · résiliation en un clic · prix TTC");
    expect(fr.landing.hero.linkPlaceholder).toBe("Colle le lien de ta vidéo ou dépose un fichier");
    expect(Object.keys(fr.landing.faq).filter((k) => k.startsWith("q")).map((k) => fr.landing.faq[k as "q1"])).toEqual([
      "Faut-il savoir monter ?", "Quelles plateformes ?", "Puis-je annuler ?", "Que se passe-t-il après les 7 jours ?",
      "Mes vidéos restent-elles privées ?", "Puis-je utiliser la vidéo d'un autre créateur ?", "Pourquoi pas de lien YouTube direct ?",
    ]);
    expect(fr.legal.company).not.toMatch(/Shrunk, Inc/);
  });

  it("contains none of the removed claims", () => {
    const text = JSON.stringify(fr.landing) + JSON.stringify(en.landing);
    for (const banned of ["GEMINI", "10X", "15 viral", "Alex Morgan", "Northstar", "™", "shrinking free", "free plan", "free trial", "gratuit"]) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

describe("landing demo clips", () => {
  const clip = (startS: number, endS: number): DemoClip => ({ title: "t", startS, endS, points: { hook: 10, standalone: 10, emotion: 10, pace: 10, duration: 20 } });

  it("formats HH:MM:SS", () => {
    expect(formatHMS(0)).toBe("00:00:00");
    expect(formatHMS(DEMO.durationS)).toBe("00:03:57");
    expect(formatHMS(3725)).toBe("01:02:05");
  });

  it("shows nothing until three valid real clips exist", () => {
    expect(DEMO_CLIPS.length === 0 || validateDemoClips(DEMO_CLIPS).length === 0).toBe(true);
    expect(availableDemoClips([])).toBeNull();
    expect(availableDemoClips([clip(0, 30)])).toBeNull();
  });

  it("rejects out-of-range and overlapping clips and accepts three valid ones", () => {
    expect(validateDemoClips([clip(0, 30), clip(20, 50), clip(60, 90)])).toContain("clips overlap");
    expect(validateDemoClips([clip(0, 30), clip(40, 70), clip(200, 300)]).length).toBeGreaterThan(0);
    expect(availableDemoClips([clip(100, 130), clip(0, 30), clip(40, 70)])?.map((c) => c.startS)).toEqual([0, 40, 100]);
  });
});

describe("landing pricing maths", () => {
  it("sells paid plans only, cheapest first", () => {
    expect(PAID_PLAN_IDS).not.toContain("free");
    expect(PAID_PLAN_IDS.map((id) => PLANS[id].monthlyCents)).toEqual([...PAID_PLAN_IDS.map((id) => PLANS[id].monthlyCents)].sort((a, b) => a - b));
  });

  it("takes the tightest of credits, analysis minutes and imports", () => {
    for (const id of PAID_PLAN_IDS) {
      const p = PLANS[id];
      const n = hourVideosPerMonth(id);
      expect(n).toBeLessThanOrEqual(p.monthlyCredits / (5 * CREDIT_COSTS.render_hd));
      expect(n).toBeLessThanOrEqual(p.monthlyAnalysisMinutes / 60);
      expect(n).toBeLessThanOrEqual(p.monthlyImports);
    }
  });

  it("picks the minimal plan or null", () => {
    expect(minimalPlan(0, 0)).toBe(PAID_PLAN_IDS[0]);
    expect(minimalPlan(PLANS.agency.monthlyAnalysisMinutes + 1, 1)).toBeNull();
    expect(minimalPlan(1, PLANS.agency.monthlyCredits / CREDIT_COSTS.render_hd + 1)).toBeNull();
  });
});
