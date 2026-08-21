import { describe, expect, it } from "vitest";
import { GAUGE_CAVEAT, bandLabel, computeGauge } from "./gauge";
import type { CriticReport } from "./critic";
import type { Tier1Report } from "./tier1";

function tier1(over: Partial<Tier1Report> = {}): Tier1Report {
  return {
    passed: true,
    blocked: false,
    citations: { total: 40, valid: 40, phantom: 0 },
    claims: { total: 30, uncited: 4, ratio: 0.1333, threshold: 0.3, overThreshold: false },
    entities: { checked: 20, mismatched: 0 },
    findings: [],
    ...over,
  };
}

function critic(over: Partial<CriticReport> = {}): CriticReport {
  return {
    ran: true,
    batches: 2,
    submitted: 10,
    judged: 10,
    judgments: [],
    counts: { supported: 10, uncertain: 0, contradicted: 0 },
    blocks: false,
    ...over,
  };
}

describe("computeGauge — the number never travels alone", () => {
  it("always carries the caveat and the labelled breakdown", () => {
    const g = computeGauge(tier1(), critic());
    expect(g.caveat).toBe(GAUGE_CAVEAT);
    // The caveat states the limit of the measurement in plain words.
    expect(g.caveat).toContain("bukan jaminan");
    expect(g.caveat).toContain("perlu ditinjau manusia");
    expect(g.breakdownLines.length).toBeGreaterThanOrEqual(4);
    expect(g.breakdownLines[0]).toContain("Sitasi valid: 40/40");
    expect(g.breakdownLines[1]).toContain("Klaim tanpa sitasi: 4 dari 30");
    expect(g.breakdownLines[1]).toContain("ambang 30%");
    expect(g.breakdownLines[1]).toContain("di bawah ambang");
  });

  it("names the components the way the UI shows them", () => {
    const g = computeGauge(
      tier1({ entities: { checked: 12, mismatched: 2 } }),
      critic({ counts: { supported: 7, uncertain: 2, contradicted: 1 }, judged: 10 }),
    );
    const joined = g.breakdownLines.join(" | ");
    expect(joined).toContain("tidak ditemukan di sumber: 2");
    expect(joined).toContain("Ditandai AI untuk ditinjau: 3");
    expect(joined).toContain("1 kontradiksi");
    expect(joined).toContain("2 tidak pasti");
  });

  it("says so out loud when Tier 2 has not run — unverified is not clean", () => {
    const g = computeGauge(tier1(), null);
    expect(g.breakdownLines.join(" ")).toContain("belum dijalankan");
    expect(g.breakdown.criticRan).toBe(false);
    // And it cannot reach the top band on Tier 1 evidence alone.
    expect(g.band).toBe("cukup");
    expect(g.score).toBeLessThan(1);
  });
});

describe("computeGauge — score formula", () => {
  it("is 1.0 only for a clean module with a completed second opinion", () => {
    expect(computeGauge(tier1(), critic()).score).toBe(1);
  });

  it("scales with the share of valid citations", () => {
    const g = computeGauge(
      tier1({ citations: { total: 40, valid: 38, phantom: 2 }, blocked: true, passed: false }),
      critic(),
    );
    expect(g.score).toBeCloseTo(0.95, 4);
  });

  it("penalises an over-threshold uncited ratio", () => {
    const g = computeGauge(
      tier1({ claims: { total: 30, uncited: 15, ratio: 0.5, threshold: 0.3, overThreshold: true } }),
      critic(),
    );
    expect(g.score).toBeCloseTo(0.85, 4);
    expect(g.breakdownLines[1]).toContain("di atas ambang");
  });

  it("caps the entity-mismatch penalty so regex noise cannot sink the score", () => {
    const many = computeGauge(tier1({ entities: { checked: 80, mismatched: 40 } }), critic());
    expect(many.score).toBeCloseTo(0.9, 4);
  });

  it("caps the critic penalty as well (a second opinion is not a verdict)", () => {
    const g = computeGauge(
      tier1(),
      critic({ counts: { supported: 0, uncertain: 10, contradicted: 10 }, judged: 20 }),
    );
    expect(g.score).toBeCloseTo(0.7, 4);
  });

  it("never leaves the 0..1 range", () => {
    const g = computeGauge(
      tier1({
        citations: { total: 10, valid: 0, phantom: 10 },
        blocked: true,
        passed: false,
        claims: { total: 10, uncited: 10, ratio: 1, threshold: 0.3, overThreshold: true },
        entities: { checked: 50, mismatched: 50 },
      }),
      critic({ counts: { supported: 0, uncertain: 20, contradicted: 20 }, judged: 40 }),
    );
    expect(g.score).toBe(0);
  });

  it("treats a module with no citations as neutral rather than perfect", () => {
    const g = computeGauge(
      tier1({ citations: { total: 0, valid: 0, phantom: 0 }, claims: { total: 0, uncited: 0, ratio: 0, threshold: 0.3, overThreshold: false } }),
      null,
    );
    // Base 1 (nothing to check) minus the "Tier 2 never ran" penalty.
    expect(g.score).toBeCloseTo(0.95, 4);
    expect(g.band).toBe("cukup");
  });
});

describe("computeGauge — bands map to check categories, not to a gradient", () => {
  it("Tier 1 FAIL → ditahan, regardless of how high the score is", () => {
    const g = computeGauge(
      tier1({ citations: { total: 100, valid: 99, phantom: 1 }, blocked: true, passed: false }),
      critic(),
    );
    expect(g.score).toBeGreaterThan(0.98);
    expect(g.band).toBe("ditahan");
    expect(g.blocked).toBe(true);
    expect(bandLabel(g.band)).toContain("Ditahan");
  });

  it("a contradicted verdict → perlu-tinjau", () => {
    const g = computeGauge(
      tier1(),
      critic({ counts: { supported: 9, uncertain: 0, contradicted: 1 }, judged: 10 }),
    );
    expect(g.band).toBe("perlu-tinjau");
  });

  it("warnings only → cukup", () => {
    expect(computeGauge(tier1({ entities: { checked: 10, mismatched: 1 } }), critic()).band).toBe("cukup");
    expect(
      computeGauge(
        tier1({ claims: { total: 10, uncited: 6, ratio: 0.6, threshold: 0.3, overThreshold: true } }),
        critic(),
      ).band,
    ).toBe("cukup");
    expect(
      computeGauge(tier1(), critic({ counts: { supported: 9, uncertain: 1, contradicted: 0 }, judged: 10 })).band,
    ).toBe("cukup");
  });

  it("nothing flagged on either tier → baik", () => {
    expect(computeGauge(tier1(), critic()).band).toBe("baik");
  });
});

describe("computeGauge — flagCount drives the repair affordance", () => {
  it("counts Tier 1 WARNs plus Tier 2 non-supported verdicts", () => {
    const g = computeGauge(
      tier1({
        findings: [
          { check: "entity_grounding", severity: "warn", claimText: "a", n: 1, citedPaperId: "p1", reason: "r" },
          { check: "uncited_claim_ratio", severity: "warn", claimText: "b", n: null, citedPaperId: null, reason: "r" },
          { check: "citation_exists", severity: "fail", claimText: "c", n: 9, citedPaperId: null, reason: "r" },
        ],
        blocked: true,
        passed: false,
      }),
      critic({ counts: { supported: 5, uncertain: 2, contradicted: 1 }, judged: 8 }),
    );
    // 2 WARNs + 3 AI flags. The FAIL is counted by `blocked`, not by flagCount.
    expect(g.flagCount).toBe(5);
  });

  it("is 0 for a clean module (so the UI offers no regeneration)", () => {
    expect(computeGauge(tier1(), critic()).flagCount).toBe(0);
  });
});
