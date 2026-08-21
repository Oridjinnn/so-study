import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the Gemini call and the usage logger so the essay path is fully isolated.
vi.mock("./gemini", () => ({ generate: vi.fn() }));
vi.mock("./aiusage", () => ({ logAIUsage: vi.fn(async () => {}) }));

import { generate, type GeminiUsage } from "./gemini";
import { logAIUsage } from "./aiusage";
import {
  generateEssayPrompt,
  generateEssayPromptHarness,
  generateEssayPromptWithFallback,
  buildEssayRubric,
} from "./essay";

const gen = generate as unknown as ReturnType<typeof vi.fn>;
const log = logAIUsage as unknown as ReturnType<typeof vi.fn>;

function ok(text: string, usage: GeminiUsage = { promptTokens: 10, candidatesTokens: 5 }) {
  return { text, usage };
}

const KEY_CONCEPT_MODULE = `
# MODUL: TEORI HABITUS

## Konsep kunci & definisi
Habitus adalah skema tindakan yang dibentuk sejarah.
Habitualitas menunjukkan pengulangan pola dalam praktik.

## Argumen utama tiap sumber
Habitus memengaruhi cara individu memahami dunia sosial.
Strukturalisme membandingkan habitus dengan struktur sosial yang mendalam.
`;

beforeEach(() => {
  gen.mockReset();
  log.mockReset();
});

describe("generateEssayPrompt", () => {
  it("returns the validated prompt and logs an essay usage row on success", async () => {
    gen.mockResolvedValue(ok('{"prompt":"Jelaskan habitus dengan kata sendiri."}'));
    const r = await generateEssayPrompt("modul …", "t1");
    expect(r).toBe("Jelaskan habitus dengan kata sendiri.");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "essay", topicId: "t1" }),
    );
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it("builds a 5W1H essay prompt anchored to THIS module's concepts", async () => {
    gen.mockResolvedValue(
      ok(
        '{"prompt":"Tulis esai tentang TEORI HABITUS. Panduan 5W1H: Apa itu habitus? Siapa yang membentuknya? Mengapa habitus penting? Bagaimana habitualitas terbentuk?"}',
      ),
    );
    const r = await generateEssayPrompt(KEY_CONCEPT_MODULE, "t1");
    expect(r).toBeTruthy();
    expect(r?.toLowerCase()).toContain("apa");
    expect(r?.toLowerCase()).toContain("mengapa");
    expect(r?.toLowerCase()).toContain("bagaimana");
    // Module-specific anchor (not generic) must be fed to the generator.
    const calledWith = JSON.stringify(gen.mock.calls[0]);
    expect(calledWith).toContain("habitus");
  });

  it("does NOT silently swallow malformed JSON — logs essay_failed and retries", async () => {
    // First call returns prose-wrapped / broken JSON; second call also broken.
    gen.mockResolvedValue(ok('Sure! Here is the prompt: {"prompt": "x" but missing brace'));
    const r = await generateEssayPrompt("modul …", "t1");
    // Both attempts failed → null (UI shows the retry affordance).
    expect(r).toBeNull();
    // The failure was logged, and we actually tried the stricter retry.
    expect(gen).toHaveBeenCalledTimes(2);
    const failed = log.mock.calls.filter((c) => c[0].kind === "essay_failed");
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[0][0]).toHaveProperty("usage");
  });

  it("recovers on the stricter retry after a malformed first response", async () => {
    gen
      .mockResolvedValueOnce(ok("not valid json at all"))
      .mockResolvedValueOnce(ok('{"prompt":"Pertanyaan yang bagus untuk refleksi."}'));
    const r = await generateEssayPrompt("modul …");
    expect(r).toBe("Pertanyaan yang bagus untuk refleksi.");
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ kind: "essay" }));
    // A failed first attempt must still be recorded before the success.
    expect(
      log.mock.calls.some((c) => c[0].kind === "essay_failed"),
    ).toBe(true);
  });

  it("logs essay_failed (not silence) when the call itself throws", async () => {
    gen.mockRejectedValue(new Error("network down"));
    const r = await generateEssayPrompt("modul …", "t2");
    expect(r).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ kind: "essay_failed" }));
  });

  it("accepts a fenced JSON object after stripping markdown fences", async () => {
    gen.mockResolvedValue(ok('```json\n{"prompt":"Apa itu habitus?"}\n```'));
    expect(await generateEssayPrompt("modul …")).toBe("Apa itu habitus?");
  });
});

describe("generateEssayPromptHarness (deterministic, 0% AI)", () => {
  it("builds a 5W1H prompt anchored to the module's topic + concepts", () => {
    const p = generateEssayPromptHarness(KEY_CONCEPT_MODULE);
    expect(p).toContain("TEORI HABITUS"); // topic anchor
    for (const w of ["apa", "siapa", "kapan", "di mana", "mengapa", "bagaimana"]) {
      expect(p.toLowerCase()).toContain(w); // 5W1H frame
    }
    expect(p.toLowerCase()).toContain("habitus"); // concept anchor
    expect(p.toLowerCase()).toContain("sumber"); // source guidance
  });

  it("is deterministic and needs no model call", () => {
    expect(generateEssayPromptHarness(KEY_CONCEPT_MODULE)).toBe(
      generateEssayPromptHarness(KEY_CONCEPT_MODULE),
    );
    expect(gen).not.toHaveBeenCalled();
  });

  it("falls back gracefully when anchors are absent", () => {
    const p = generateEssayPromptHarness("Teks tanpa struktur sama sekali.");
    expect(p.length).toBeGreaterThan(0);
    expect(p.toLowerCase()).toContain("modul");
  });
});

describe("BUG 1 + BUG 2 — essay topic title and 5W1H slot hygiene", () => {
  const REAL_TITLE = "Hubungan interaksi antar individu di era modern";

  it("BUG 1: the harness uses the real topic title, not the first section heading", () => {
    // The body's first heading is "Tujuan Pembelajaran" — a SECTION, not the title.
    const m = "## Tujuan Pembelajaran\n- Setelah membaca modul ini, kamu bisa: A.\n\n## Konsep kunci\nHabitus.";
    const p = generateEssayPromptHarness(m, REAL_TITLE);
    expect(p).toContain(REAL_TITLE);
    expect(p).not.toContain("Tujuan Pembelajaran");
  });

  it("BUG 1: the AI prompt is anchored to the real topic title, not a section heading", async () => {
    gen.mockResolvedValue(ok('{"prompt":"x"}'));
    await generateEssayPrompt("## Tujuan Pembelajaran\n...", "t1", REAL_TITLE);
    const sent = gen.mock.calls[0][0].prompt as string;
    expect(sent).toContain(`Topik: ${REAL_TITLE}`);
    expect(sent).not.toContain("Topik: Tujuan Pembelajaran");
  });

  it("BUG 2: harness never injects raw, truncated body substrings into 5W1H slots", () => {
    const m = [
      "## Konsep kunci & definisi",
      "Interaksi sosial adalah hubungan antar individu.",
      "",
      "Dalam kajian Teori Antropologi Kontemporer, interaksi antar individu di era modern menunjukkan pola pertukaran yang simbolik dan berulang secara historis di berbagai masyarakat.",
    ].join("\n");
    const p = generateEssayPromptHarness(m, REAL_TITLE);

    // No raw body slice leaked in (the old break produced "terlibat dalam Dalam
    // kajian Teori … antari?").
    expect(p.toLowerCase()).not.toContain("dalam kajian");
    expect(p.toLowerCase()).not.toContain("antari");
    expect(p).toContain(REAL_TITLE);
    expect(p).not.toContain("Tujuan Pembelajaran");

    // No duplicated adjacent word (case-insensitive) — e.g. "dalam Dalam".
    const words = p.toLowerCase().split(/\s+/).filter(Boolean);
    for (let i = 1; i < words.length; i++) {
      expect(words[i]).not.toBe(words[i - 1]);
    }
  });
});

describe("generateEssayPromptWithFallback", () => {
  it("returns the AI prompt when generation succeeds", async () => {
    gen.mockResolvedValue(ok('{"prompt":"Pertanyaan AI."}'));
    const r = await generateEssayPromptWithFallback("modul …", "t1");
    expect(r).toBe("Pertanyaan AI.");
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ kind: "essay" }));
  });

  it("falls back to the harness (never null) when the AI call throws", async () => {
    gen.mockRejectedValue(new Error("network down"));
    const r = await generateEssayPromptWithFallback(KEY_CONCEPT_MODULE, "t1");
    expect(r).toBeTruthy();
    expect(r).toContain("TEORI HABITUS");
    // The harness path is observable: a zero-token essay_harness row is logged.
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ kind: "essay_harness" }));
  });

  it("falls back to the harness when the AI returns malformed JSON twice", async () => {
    gen.mockResolvedValue(ok("totally not json"));
    const r = await generateEssayPromptWithFallback(KEY_CONCEPT_MODULE);
    expect(r).toContain("TEORI HABITUS");
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ kind: "essay_harness" }));
  });
});

describe("buildEssayRubric (harness, 0% AI)", () => {
  it("derives key-concept criteria from the module's Konsep kunci section", () => {
    const rubric = buildEssayRubric(KEY_CONCEPT_MODULE);
    expect(rubric).toContain("Rubrik esai");
    expect(rubric.toLowerCase()).toContain("habitus");
    expect(rubric).toContain("Mengaitkan argumen dari tiap sumber");
    expect(rubric).toContain("Menyimpulkan relevansi");
  });

  it("evaluates penulisan, penafsiran, and penalaran", () => {
    const rubric = buildEssayRubric(KEY_CONCEPT_MODULE).toLowerCase();
    expect(rubric).toContain("penulisan");
    expect(rubric).toContain("penafsiran");
    expect(rubric).toContain("penalaran");
    // 5W1H reasoning framing is present in the strengthened harness.
    expect(rubric).toContain("5w1h");
  });

  it("is deterministic for the same module", () => {
    expect(buildEssayRubric(KEY_CONCEPT_MODULE)).toBe(buildEssayRubric(KEY_CONCEPT_MODULE));
  });
});
