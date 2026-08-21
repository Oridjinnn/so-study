import { describe, expect, it, vi } from "vitest";
import {
  CLAIMS_PER_BATCH,
  CRITIC_RESPONSE_SCHEMA,
  MAX_CLAIMS,
  buildCriticPrompt,
  collectCitedClaims,
  criticFlags,
  mergeCriticReports,
  pruneCriticReport,
  runCritic,
  type CriticClaim,
} from "./critic";

// Tier 2 is mocked everywhere here: the point of these tests is that the FLAGS
// surface intact and that nothing in the pipeline can turn a model opinion into a
// rejection. No real Gemini call is ever made.

const SOURCES = [
  { id: "p1", title: "Social Construction of Reality", text: "Berger and Luckmann, dialectic." },
  { id: "p2", title: "Theory of Practice", text: "Bourdieu, habitus, Kabylia." },
];
const PAPER_IDS = ["p1", "p2"];

function claim(i: number): CriticClaim {
  return {
    claimText: `Klaim nomor ${i} yang dikutip dari sumber.`,
    n: 1,
    citedPaperId: "p1",
    paperTitle: "Social Construction of Reality",
    paperText: "Berger and Luckmann, dialectic.",
  };
}

function jsonReply(entries: { claimText: string; verdict: string; note?: string; paperId?: string }[]) {
  return JSON.stringify(
    entries.map((e) => ({
      claimText: e.claimText,
      citedPaperId: e.paperId ?? "p1",
      verdict: e.verdict,
      note: e.note ?? "catatan",
    })),
  );
}

describe("collectCitedClaims", () => {
  it("pairs each cited sentence with the approved paper it cites", () => {
    const claims = collectCitedClaims(
      {
        contentMarkdown: "Habitus adalah disposisi [2]. Realitas dibentuk secara sosial [1].",
        sourcePaperIds: PAPER_IDS,
      },
      SOURCES,
    );
    expect(claims).toHaveLength(2);
    expect(claims[0].citedPaperId).toBe("p2");
    expect(claims[0].paperTitle).toBe("Theory of Practice");
    expect(claims[1].citedPaperId).toBe("p1");
  });

  it("yields one claim per cited paper when a sentence cites several", () => {
    const claims = collectCitedClaims(
      { contentMarkdown: "Keduanya sepakat soal praktik [1][2].", sourcePaperIds: PAPER_IDS },
      SOURCES,
    );
    // One verdict per (claim, source): a claim can be supported by one paper and
    // contradicted by the other, and collapsing that would hide the conflict.
    expect(claims.map((c) => c.citedPaperId)).toEqual(["p1", "p2"]);
  });

  it("skips phantom citations (nothing to judge against)", () => {
    const claims = collectCitedClaims(
      { contentMarkdown: "Klaim tanpa sumber nyata [9].", sourcePaperIds: PAPER_IDS },
      SOURCES,
    );
    expect(claims).toEqual([]);
  });

  it("caps the claim count (cost bound)", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Klaim ${i} yang dikutip [1].`).join("\n");
    const claims = collectCitedClaims({ contentMarkdown: many, sourcePaperIds: PAPER_IDS }, SOURCES);
    expect(claims).toHaveLength(MAX_CLAIMS);
  });
});

describe("buildCriticPrompt", () => {
  it("puts each claim next to the actual source text it cites", () => {
    const prompt = buildCriticPrompt([claim(1)]);
    expect(prompt).toContain("Klaim nomor 1 yang dikutip dari sumber.");
    expect(prompt).toContain("Berger and Luckmann, dialectic.");
    expect(prompt).toContain("p1");
  });
});

describe("runCritic", () => {
  it("surfaces verdicts as flags and NEVER blocks", async () => {
    const generate = vi.fn().mockResolvedValue({
      text: jsonReply([
        { claimText: claim(1).claimText, verdict: "contradicted", note: "sumber menyatakan sebaliknya" },
        { claimText: claim(2).claimText, verdict: "uncertain", note: "sumber tidak membahas" },
        { claimText: claim(3).claimText, verdict: "supported", note: "sesuai abstrak" },
      ]),
      usage: { promptTokens: 10, candidatesTokens: 5 },
    });
    const report = await runCritic([claim(1), claim(2), claim(3)], generate);

    expect(report.ran).toBe(true);
    expect(report.judged).toBe(3);
    expect(report.counts).toEqual({ supported: 1, uncertain: 1, contradicted: 1 });
    // The contract that matters: Tier 2 has no blocking power, whatever it thinks.
    expect(report.blocks).toBe(false);
    expect(Object.keys(report)).not.toContain("blocked");

    const flags = criticFlags(report);
    expect(flags.map((f) => f.verdict).sort()).toEqual(["contradicted", "uncertain"]);
    expect(flags[0].note).toBe("sumber menyatakan sebaliknya");
    // Supported verdicts are KEPT in the stored report so the gauge can show a
    // distribution instead of "3 flags" with no denominator.
    expect(report.judgments).toHaveLength(3);
  });

  it("uses JSON mode with the declared responseSchema", async () => {
    const generate = vi
      .fn()
      .mockResolvedValue({ text: jsonReply([{ claimText: claim(1).claimText, verdict: "supported" }]) });
    await runCritic([claim(1)], generate);
    const opts = generate.mock.calls[0][0];
    expect(opts.responseMimeType).toBe("application/json");
    expect(opts.responseSchema).toBe(CRITIC_RESPONSE_SCHEMA);
    expect(opts.system.toLowerCase()).toContain("sumber");
  });

  it("links each judgment back to the submitted claim index", async () => {
    const generate = vi.fn().mockResolvedValue({
      // Re-cased + re-spaced by the model: still linkable.
      text: jsonReply([{ claimText: "  klaim nomor 2 yang dikutip dari sumber.  ", verdict: "uncertain" }]),
    });
    const report = await runCritic([claim(1), claim(2)], generate, { batchSize: 2 });
    expect(report.judgments[0].claimIndex).toBe(1);
  });

  it("reports claimIndex null when a returned claim cannot be matched", async () => {
    const generate = vi
      .fn()
      .mockResolvedValue({ text: jsonReply([{ claimText: "kalimat yang tidak ada di modul", verdict: "uncertain" }]) });
    const report = await runCritic([claim(1)], generate);
    expect(report.judgments[0].claimIndex).toBeNull();
  });

  it("batches to bound the call count", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "[]" });
    const claims = Array.from({ length: 7 }, (_, i) => claim(i));
    await runCritic(claims, generate, { batchSize: 3 });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(CLAIMS_PER_BATCH).toBeGreaterThan(1);
  });

  it("records a malformed response as an error instead of a clean bill", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "maaf, ini bukan JSON" });
    const report = await runCritic([claim(1)], generate);
    expect(report.ran).toBe(false);
    expect(report.judged).toBe(0);
    expect(report.error).toContain("skema");
    expect(report.blocks).toBe(false);
  });

  it("survives a thrown call and keeps the batches that did parse", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ text: jsonReply([{ claimText: claim(1).claimText, verdict: "supported" }]) })
      .mockRejectedValueOnce(new Error("Gemini HTTP 503"));
    const report = await runCritic([claim(1), claim(2)], generate, { batchSize: 1 });
    expect(report.judged).toBe(1);
    expect(report.error).toContain("503");
    expect(report.blocks).toBe(false);
  });

  it("skips the call entirely when there is nothing cited to judge", async () => {
    const generate = vi.fn();
    const report = await runCritic([], generate);
    expect(generate).not.toHaveBeenCalled();
    expect(report.ran).toBe(false);
    expect(report.batches).toBe(0);
  });

  it("reports usage per call so the paid tier stays observable", async () => {
    const onUsage = vi.fn();
    const generate = vi.fn().mockResolvedValue({
      text: jsonReply([{ claimText: claim(1).claimText, verdict: "supported" }]),
      usage: { promptTokens: 100, candidatesTokens: 20 },
    });
    await runCritic([claim(1)], generate, { onUsage });
    expect(onUsage).toHaveBeenCalledWith({ promptTokens: 100, candidatesTokens: 20 });
  });
});

describe("mergeCriticReports / pruneCriticReport", () => {
  const base = {
    ran: true,
    batches: 1,
    submitted: 2,
    judged: 2,
    judgments: [
      { claimText: "Klaim A [1].", citedPaperId: "p1", verdict: "uncertain" as const, note: "lama", claimIndex: 0 },
      { claimText: "Klaim B [1].", citedPaperId: "p1", verdict: "supported" as const, note: "ok", claimIndex: 1 },
    ],
    counts: { supported: 1, uncertain: 1, contradicted: 0 },
    blocks: false as const,
  };

  it("replaces verdicts for re-judged claims and keeps the rest", () => {
    const fresh = {
      ...base,
      batches: 1,
      submitted: 1,
      judged: 1,
      judgments: [
        { claimText: "Klaim A [1].", citedPaperId: "p1", verdict: "supported" as const, note: "baru", claimIndex: 0 },
      ],
      counts: { supported: 1, uncertain: 0, contradicted: 0 },
    };
    const merged = mergeCriticReports(base, fresh);
    expect(merged.judgments).toHaveLength(2);
    expect(merged.judgments.find((j) => j.claimText === "Klaim A [1].")?.note).toBe("baru");
    expect(merged.counts).toEqual({ supported: 2, uncertain: 0, contradicted: 0 });
    expect(merged.blocks).toBe(false);
  });

  it("drops verdicts about claims that no longer exist", () => {
    const pruned = pruneCriticReport(base, ["Klaim A [1]."]);
    expect(pruned?.judgments.map((j) => j.claimText)).toEqual(["Klaim B [1]."]);
    expect(pruned?.counts).toEqual({ supported: 1, uncertain: 0, contradicted: 0 });
  });
});
