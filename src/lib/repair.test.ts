import { describe, expect, it } from "vitest";
import {
  MAX_REPAIR_ATTEMPTS,
  REPAIR_RESPONSE_SCHEMA,
  applyRepairs,
  buildRepairPrompt,
  buildRepairSystem,
  collectRepairItems,
  parseRepairResponse,
  type RepairItem,
} from "./repair";
import type { CriticFlag } from "./critic";
import type { Tier1Finding } from "./tier1";

const SOURCES = [
  {
    id: "p1",
    title: "The Social Construction of Reality",
    text: "Berger and Luckmann describe externalization, objectivation and internalization.",
  },
  { id: "p2", title: "Outline of a Theory of Practice", text: "Bourdieu develops habitus in Kabylia." },
];

const TIER1_WARN: Tier1Finding = {
  check: "entity_grounding",
  severity: "warn",
  claimText: "Menurut Giddens, strukturasi menjelaskan interaksi modern [2].",
  n: 2,
  citedPaperId: "p2",
  reason: "nama/angka spesifik dekat sitasi tidak ditemukan di teks sumber: Giddens",
};

const TIER2_FLAG: CriticFlag = {
  claimText: "Realitas sosial ditentukan sepenuhnya oleh struktur ekonomi [1].",
  citedPaperId: "p1",
  verdict: "contradicted",
  note: "sumber menekankan dialektika, bukan determinasi ekonomi",
  claimIndex: 3,
};

describe("collectRepairItems", () => {
  it("resolves each flag to the source text needed to fix it", () => {
    const items = collectRepairItems([TIER1_WARN], [TIER2_FLAG], SOURCES);
    expect(items).toHaveLength(2);
    const t1 = items.find((i) => i.origin === "tier1")!;
    expect(t1.paperTitle).toBe("Outline of a Theory of Practice");
    expect(t1.paperText).toContain("Bourdieu develops habitus");
    const t2 = items.find((i) => i.origin === "tier2")!;
    expect(t2.reason).toContain("contradicted");
    expect(t2.paperText).toContain("Berger and Luckmann");
  });

  it("ignores supported verdicts — there is nothing to fix", () => {
    const supported: CriticFlag = { ...TIER2_FLAG, verdict: "supported" };
    expect(collectRepairItems([], [supported], SOURCES)).toEqual([]);
  });

  it("collapses a claim flagged by both tiers into one item with both reasons", () => {
    const sameClaim: CriticFlag = { ...TIER2_FLAG, claimText: TIER1_WARN.claimText };
    const items = collectRepairItems([TIER1_WARN], [sameClaim], SOURCES);
    expect(items).toHaveLength(1);
    expect(items[0].reason).toContain("Giddens");
    expect(items[0].reason).toContain("contradicted");
  });

  it("includes Tier 1 FAIL items (a phantom citation is exactly what needs fixing)", () => {
    const fail: Tier1Finding = {
      check: "citation_exists",
      severity: "fail",
      claimText: "Klaim dengan sitasi hantu [9].",
      n: 9,
      citedPaperId: null,
      reason: "sitasi [9] tidak ada",
    };
    const items = collectRepairItems([fail], [], SOURCES);
    expect(items).toHaveLength(1);
    expect(items[0].paperText).toBeNull();
  });
});

describe("buildRepairPrompt — targeted, not generic", () => {
  const items = collectRepairItems([TIER1_WARN], [TIER2_FLAG], SOURCES);
  const prompt = buildRepairPrompt(items);

  it("quotes the exact flagged claim text", () => {
    expect(prompt).toContain("Menurut Giddens, strukturasi menjelaskan interaksi modern [2].");
    expect(prompt).toContain("Realitas sosial ditentukan sepenuhnya oleh struktur ekonomi [1].");
  });

  it("states WHY each claim was flagged", () => {
    expect(prompt).toContain("tidak ditemukan di teks sumber: Giddens");
    expect(prompt).toContain("sumber menekankan dialektika");
  });

  it("includes the cited source's real content, not just its id", () => {
    expect(prompt).toContain("Berger and Luckmann describe externalization");
    expect(prompt).toContain("Bourdieu develops habitus in Kabylia.");
  });

  it("asks for the three narrow actions and forbids a full rewrite", () => {
    expect(prompt).toContain("diperbaiki");
    expect(prompt).toContain("disitir");
    expect(prompt).toContain("dihapus");
    expect(prompt).toContain("Jangan menulis ulang bagian modul");
    // And it is NOT the generic instruction this whole part exists to avoid.
    expect(prompt.toLowerCase()).not.toContain("perbaiki modul ini");
    expect(prompt.toLowerCase()).not.toContain("tulis ulang modul");
  });

  it("keeps the system prompt in editor mode with the course/major lens", () => {
    const system = buildRepairSystem("Teori Antropologi Kontemporer", "Antropologi");
    expect(system).toContain("Teori Antropologi Kontemporer");
    expect(system).toContain("Antropologi");
    expect(system).toContain("BUKAN menulis ulang modul");
  });

  it("declares a JSON response schema (structured output, not fenced prose)", () => {
    expect(REPAIR_RESPONSE_SCHEMA.type).toBe("array");
  });
});

describe("parseRepairResponse", () => {
  const items: RepairItem[] = [
    { claimText: "Klaim satu [1].", origin: "tier1", reason: "r1", citedPaperId: "p1", paperTitle: "t", paperText: "x" },
    { claimText: "Klaim dua [2].", origin: "tier2", reason: "r2", citedPaperId: "p2", paperTitle: "t", paperText: "x" },
  ];

  it("parses the JSON array form", () => {
    const text = JSON.stringify([
      { index: 1, action: "diperbaiki", revisedText: "Klaim satu yang benar [1]." },
      { index: 2, action: "dihapus", revisedText: "" },
    ]);
    const revs = parseRepairResponse(text, items);
    expect(revs).toHaveLength(2);
    expect(revs[0].originalClaim).toBe("Klaim satu [1].");
    expect(revs[0].revisedText).toBe("Klaim satu yang benar [1].");
    expect(revs[1].removed).toBe(true);
  });

  it("accepts an object wrapper around the array", () => {
    const text = JSON.stringify({ revisions: [{ index: 1, action: "disitir", revisedText: "Klaim satu [2]." }] });
    expect(parseRepairResponse(text, items)[0].revisedText).toBe("Klaim satu [2].");
  });

  it("falls back to the numbered-text form when JSON mode is not honoured", () => {
    const revs = parseRepairResponse("1. Klaim satu direvisi [1].\n2. [DIHAPUS] tidak didukung", items);
    expect(revs[0].revisedText).toBe("Klaim satu direvisi [1].");
    expect(revs[1].removed).toBe(true);
  });

  it("ignores indices that do not exist and skipped claims stay unrevised", () => {
    const text = JSON.stringify([{ index: 9, action: "diperbaiki", revisedText: "entah" }]);
    expect(parseRepairResponse(text, items)).toEqual([]);
  });
});

describe("applyRepairs — surgical replacement", () => {
  const markdown = [
    "## Konsep kunci",
    "",
    "Klaim satu [1]. Kalimat lain yang sehat dan tidak boleh berubah [1].",
    "",
    "Klaim dua [2].",
  ].join("\n");

  it("replaces only the flagged sentences and leaves the rest byte-identical", () => {
    const out = applyRepairs(markdown, [
      { index: 1, originalClaim: "Klaim satu [1].", revisedText: "Klaim satu yang akurat [1].", removed: false },
    ]);
    expect(out.applied).toBe(1);
    expect(out.markdown).toContain("Klaim satu yang akurat [1].");
    expect(out.markdown).toContain("Kalimat lain yang sehat dan tidak boleh berubah [1].");
    expect(out.markdown).toContain("Klaim dua [2].");
    expect(out.markdown).toContain("## Konsep kunci");
    expect(out.revisedTexts).toEqual(["Klaim satu yang akurat [1]."]);
    expect(out.staleClaimTexts).toEqual(["Klaim satu [1]."]);
  });

  it("removes an unsupportable claim and records it as stale", () => {
    const out = applyRepairs(markdown, [
      { index: 2, originalClaim: "Klaim dua [2].", revisedText: "", removed: true },
    ]);
    expect(out.markdown).not.toContain("Klaim dua [2].");
    expect(out.staleClaimTexts).toEqual(["Klaim dua [2]."]);
    expect(out.revisedTexts).toEqual([]);
  });

  it("applies nothing when the claim is no longer in the text", () => {
    const out = applyRepairs(markdown, [
      { index: 1, originalClaim: "Kalimat yang sudah hilang [1].", revisedText: "apa pun", removed: false },
    ]);
    expect(out.applied).toBe(0);
    expect(out.markdown).toBe(markdown);
  });

  it("treats an unchanged revision as no-op (no version churn)", () => {
    const out = applyRepairs(markdown, [
      { index: 1, originalClaim: "Klaim satu [1].", revisedText: "Klaim satu [1].", removed: false },
    ]);
    expect(out.applied).toBe(0);
  });
});

describe("attempt cap", () => {
  it("reuses the 2-attempt cap pattern", () => {
    expect(MAX_REPAIR_ATTEMPTS).toBe(2);
  });
});
