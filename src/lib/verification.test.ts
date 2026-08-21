import { describe, expect, it, vi } from "vitest";
import {
  parseCriticReport,
  parseTier1Report,
  pendingRepairItems,
  runTargetedRepair,
  runVerification,
  verificationPayload,
} from "./verification";
import { MAX_REPAIR_ATTEMPTS } from "./repair";
import { verifyTier1 } from "./tier1";

const SOURCES = [
  {
    id: "p1",
    title: "The Social Construction of Reality",
    text: "Berger and Luckmann describe externalization, objectivation and internalization.",
  },
  { id: "p2", title: "Outline of a Theory of Practice", text: "Bourdieu develops habitus in Kabylia." },
];
const PAPER_IDS = ["p1", "p2"];

function jsonRevisions(entries: { index: number; action: string; revisedText: string }[]) {
  return JSON.stringify(entries);
}

function criticReply(entries: { claimText: string; verdict: string }[]) {
  return JSON.stringify(
    entries.map((e) => ({ claimText: e.claimText, citedPaperId: "p1", verdict: e.verdict, note: "n" })),
  );
}

describe("runVerification", () => {
  const mod = {
    contentMarkdown: "Realitas sosial adalah hasil eksternalisasi dan internalisasi [1].",
    sourcePaperIds: PAPER_IDS,
  };

  it("runs Tier 1 only when tier2 is not requested (no paid call)", async () => {
    const generate = vi.fn();
    const out = await runVerification(mod, SOURCES, { tier2: false, generate });
    expect(generate).not.toHaveBeenCalled();
    expect(out.tier1.blocked).toBe(false);
    expect(out.critic).toBeNull();
    // The gauge is honest about the missing second opinion.
    expect(out.gauge.breakdown.criticRan).toBe(false);
  });

  it("runs Tier 2 when asked and folds it into the gauge without gating", async () => {
    const generate = vi.fn().mockResolvedValue({
      text: criticReply([{ claimText: mod.contentMarkdown, verdict: "contradicted" }]),
      usage: { promptTokens: 5, candidatesTokens: 2 },
    });
    const onUsage = vi.fn();
    const out = await runVerification(mod, SOURCES, { tier2: true, generate, onUsage });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(out.critic?.counts.contradicted).toBe(1);
    expect(out.critic?.blocks).toBe(false);
    expect(out.gauge.band).toBe("perlu-tinjau");
    // A contradicted verdict raises a flag but never blocks.
    expect(out.tier1.blocked).toBe(false);
    expect(out.gauge.blocked).toBe(false);
    expect(onUsage).toHaveBeenCalled();
  });

  it("keeps Tier 1's verdict when Tier 2 fails outright", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("Gemini HTTP 500"));
    // A real citation [1] so Tier 2 actually attempts the call (a phantom-only
    // mod would short-circuit with "no claims to check" instead of calling).
    const out = await runVerification(
      { contentMarkdown: "Realitas sosial adalah eksternalisasi [1]. Klaim hantu [9].", sourcePaperIds: PAPER_IDS },
      SOURCES,
      { tier2: true, generate },
    );
    expect(out.tier1.blocked).toBe(true);
    expect(out.critic?.ran).toBe(false);
    expect(out.critic?.error).toContain("500");
  });

  it("short-circuits Tier 2 (no error) when no citeable claim survives Tier 1", async () => {
    const generate = vi.fn();
    const out = await runVerification(
      { contentMarkdown: "Klaim dengan sitasi hantu [9].", sourcePaperIds: PAPER_IDS },
      SOURCES,
      { tier2: true, generate },
    );
    expect(out.tier1.blocked).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    // The honest "nothing to check" state, not a crash.
    expect(out.critic?.error).toContain("tidak ada klaim bersitasi");
    expect(out.critic?.ran).toBe(false);
  });
});

describe("stored-report parsing", () => {
  it("round-trips a real report", () => {
    const tier1 = verifyTier1(
      { contentMarkdown: "Habitus adalah disposisi [2].", sourcePaperIds: PAPER_IDS },
      SOURCES,
    );
    expect(parseTier1Report(JSON.stringify(tier1))).toEqual(tier1);
  });

  it("degrades unreadable or stale JSON to 'not verified', never to 'clean'", () => {
    expect(parseTier1Report("{ not json")).toBeNull();
    expect(parseTier1Report(JSON.stringify({ passed: true }))).toBeNull();
    expect(parseCriticReport(null)).toBeNull();
    // A stored critic report that claims blocking power is not one we wrote.
    expect(parseCriticReport(JSON.stringify({ ran: true, blocks: true }))).toBeNull();
  });

  it("builds a null gauge when Tier 1 has never run", () => {
    const payload = verificationPayload({ verifyReport: null, criticReport: null });
    expect(payload.gauge).toBeNull();
    expect(payload.tier1).toBeNull();
    expect(payload.repairAttempts).toBe(0);
  });

  it("exposes the gauge as soon as Tier 1 is present", () => {
    const tier1 = verifyTier1({ contentMarkdown: "Klaim [1].", sourcePaperIds: PAPER_IDS }, SOURCES);
    const payload = verificationPayload({
      verifyReport: JSON.stringify(tier1),
      criticReport: null,
      verifiedAt: new Date("2026-08-21T12:00:00Z"),
      repairAttempts: 1,
    });
    expect(payload.gauge?.score).toBeGreaterThan(0);
    expect(payload.verifiedAt).toBe("2026-08-21T12:00:00.000Z");
    expect(payload.repairAttempts).toBe(1);
  });
});

describe("runTargetedRepair", () => {
  // A mod with one phantom citation (Tier 1 FAIL) and one healthy sentence.
  const markdown = [
    "## Konsep kunci",
    "",
    "Habitus adalah disposisi yang mewujud dalam tubuh [2].",
    "",
    "Interaksi modern adalah hasil determinasi teknologi [9].",
  ].join("\n");
  const sourcePaperIds = PAPER_IDS;

  function tier1Of(text: string) {
    return verifyTier1({ contentMarkdown: text, sourcePaperIds }, SOURCES);
  }

  it("builds the repair call from the flags and fixes only the flagged claim", async () => {
    const generate = vi.fn(async (opts: { prompt: string }) => {
      if (opts.prompt.startsWith("Periksa")) {
        // Tier 2 re-run over the touched claim.
        return { text: criticReply([{ claimText: "x", verdict: "supported" }]) };
      }
      // The prompt must carry the flagged sentence verbatim.
      expect(opts.prompt).toContain("Interaksi modern adalah hasil determinasi teknologi [9].");
      expect(opts.prompt).toContain("sitasi [9] tidak ada");
      return {
        text: jsonRevisions([
          {
            index: 1,
            action: "diperbaiki",
            revisedText: "Interaksi modern dibentuk melalui internalisasi makna [1].",
          },
        ]),
      };
    });

    const out = await runTargetedRepair({
      markdown,
      sourcePaperIds,
      sources: SOURCES,
      tier1: tier1Of(markdown),
      critic: null,
      generate,
      system: "sys",
      maxPasses: MAX_REPAIR_ATTEMPTS,
    });

    expect(out.passes).toBe(1);
    expect(out.appliedRevisions).toBe(1);
    expect(out.markdown).toContain("Interaksi modern dibentuk melalui internalisasi makna [1].");
    // The untouched sentence is preserved exactly.
    expect(out.markdown).toContain("Habitus adalah disposisi yang mewujud dalam tubuh [2].");
    // Tier 1 re-ran: the phantom is gone, so the mod is no longer blocked.
    expect(out.tier1.blocked).toBe(false);
    expect(out.manualReviewNeeded).toBe(false);
  });

  it("re-runs Tier 2 ONLY for the claims the pass touched", async () => {
    const criticPrompts: string[] = [];
    const generate = vi.fn(async (opts: { prompt: string }) => {
      if (opts.prompt.startsWith("Periksa")) {
        criticPrompts.push(opts.prompt);
        return { text: criticReply([{ claimText: "y", verdict: "supported" }]) };
      }
      return {
        text: jsonRevisions([
          { index: 1, action: "diperbaiki", revisedText: "Klaim yang sudah diperbaiki dan disitir benar [1]." },
        ]),
      };
    });

    await runTargetedRepair({
      markdown,
      sourcePaperIds,
      sources: SOURCES,
      tier1: tier1Of(markdown),
      critic: null,
      generate,
      system: "sys",
      maxPasses: MAX_REPAIR_ATTEMPTS,
    });

    expect(criticPrompts).toHaveLength(1);
    expect(criticPrompts[0]).toContain("Klaim yang sudah diperbaiki dan disitir benar [1].");
    // The untouched healthy sentence is NOT re-judged (that would be paying to
    // re-verify text nobody edited).
    expect(criticPrompts[0]).not.toContain("Habitus adalah disposisi");
  });

  it("stops at the attempt cap and asks for manual review instead of looping", async () => {
    let call = 0;
    // Every pass "fixes" the claim by swapping in another phantom citation, so
    // the flag never clears — exactly the case that must not loop forever.
    const generate = vi.fn(async (opts: { prompt: string }) => {
      if (opts.prompt.startsWith("Periksa")) {
        return { text: criticReply([{ claimText: "z", verdict: "supported" }]) };
      }
      call += 1;
      return {
        text: jsonRevisions([
          { index: 1, action: "diperbaiki", revisedText: `Klaim yang masih salah sitasi versi ${call} [${8 - call}].` },
        ]),
      };
    });

    const out = await runTargetedRepair({
      markdown,
      sourcePaperIds,
      sources: SOURCES,
      tier1: tier1Of(markdown),
      critic: null,
      generate,
      system: "sys",
      maxPasses: MAX_REPAIR_ATTEMPTS,
    });

    expect(out.passes).toBe(MAX_REPAIR_ATTEMPTS);
    expect(out.tier1.blocked).toBe(true);
    expect(out.manualReviewNeeded).toBe(true);
    expect(out.remainingItems.length).toBeGreaterThan(0);
  });

  it("stops early when a pass changes nothing (no second identical bill)", async () => {
    const generate = vi.fn().mockResolvedValue({ text: jsonRevisions([]) });
    const out = await runTargetedRepair({
      markdown,
      sourcePaperIds,
      sources: SOURCES,
      tier1: tier1Of(markdown),
      critic: null,
      generate,
      system: "sys",
      maxPasses: MAX_REPAIR_ATTEMPTS,
    });
    expect(out.passes).toBe(1);
    expect(out.appliedRevisions).toBe(0);
    expect(out.markdown).toBe(markdown);
    expect(out.manualReviewNeeded).toBe(true);
  });

  it("stops without a retry when the repair call itself fails", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("Gemini HTTP 429"));
    const out = await runTargetedRepair({
      markdown,
      sourcePaperIds,
      sources: SOURCES,
      tier1: tier1Of(markdown),
      critic: null,
      generate,
      system: "sys",
      maxPasses: MAX_REPAIR_ATTEMPTS,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(out.passes).toBe(0);
    expect(out.markdown).toBe(markdown);
  });

  it("carries Tier 2 flags into the repair request alongside Tier 1 findings", async () => {
    const clean = "Realitas sosial adalah hasil eksternalisasi dan internalisasi [1].";
    const critic = {
      ran: true,
      batches: 1,
      submitted: 1,
      judged: 1,
      judgments: [
        {
          claimText: clean,
          citedPaperId: "p1",
          verdict: "contradicted" as const,
          note: "sumber tidak menyatakan determinasi",
          claimIndex: 0,
        },
      ],
      counts: { supported: 0, uncertain: 0, contradicted: 1 },
      blocks: false as const,
    };
    const prompts: string[] = [];
    const generate = vi.fn(async (opts: { prompt: string }) => {
      prompts.push(opts.prompt);
      if (opts.prompt.startsWith("Periksa")) {
        return { text: criticReply([{ claimText: "w", verdict: "supported" }]) };
      }
      return {
        text: jsonRevisions([
          { index: 1, action: "diperbaiki", revisedText: "Realitas sosial dibentuk secara dialektis [1]." },
        ]),
      };
    });

    const out = await runTargetedRepair({
      markdown: clean,
      sourcePaperIds,
      sources: SOURCES,
      tier1: tier1Of(clean),
      critic,
      generate,
      system: "sys",
      maxPasses: MAX_REPAIR_ATTEMPTS,
    });

    expect(prompts[0]).toContain("sumber tidak menyatakan determinasi");
    expect(out.markdown).toContain("Realitas sosial dibentuk secara dialektis [1].");
    // The stale verdict about the replaced sentence is dropped, not kept.
    expect(out.critic?.judgments.some((j) => j.claimText === clean)).toBe(false);
  });
});

describe("pendingRepairItems", () => {
  it("is empty for a clean mod, so the UI can offer 'already passed' instead", () => {
    const tier1 = verifyTier1(
      { contentMarkdown: "Habitus adalah disposisi [2].", sourcePaperIds: PAPER_IDS },
      SOURCES,
    );
    expect(tier1.findings).toEqual([]);
    expect(pendingRepairItems(tier1, null, SOURCES)).toEqual([]);
  });

  it("is empty when Tier 1 has never run (nothing measured, nothing to fix)", () => {
    expect(pendingRepairItems(null, null, SOURCES)).toEqual([]);
  });
});
