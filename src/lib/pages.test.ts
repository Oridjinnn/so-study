import { describe, expect, it, vi } from "vitest";
import {
  WORDS_PER_PAGE,
  MIN_WORDS,
  countWords,
  estimatePagesFromWords,
  splitSubsections,
  findThinnestSubsection,
  replaceSubsection,
  expandModuleUntilFloor,
  findMissingSections,
  detectTruncatedTail,
  type ExpandGenerateFn,
} from "./pages";

const MODULE = [
  "## Tujuan Pembelajaran",
  "- Setelah membaca modul ini, kamu bisa: A",
  "- Setelah membaca modul ini, kamu bisa: B",
  "",
  "## Mengapa topik ini penting",
  "pendek saja",
  "",
  "## Konsep kunci & definisi",
  "### Konsep A",
  "satu dua tiga empat lima",
  "### Konsep B",
  "alpha beta gamma",
  "",
  "## Perbandingan",
  "x y z",
  "",
  "## Rangkuman bab",
  "ringkas",
  "",
  "## Daftar istilah kunci",
  "glos",
].join("\n");

describe("page estimate", () => {
  it("returns 1 for empty/zero words (never shows 0 halaman)", () => {
    expect(estimatePagesFromWords(0)).toBe(1);
  });

  it("rounds up at the defined words-per-page constant", () => {
    expect(estimatePagesFromWords(WORDS_PER_PAGE)).toBe(1);
    expect(estimatePagesFromWords(WORDS_PER_PAGE + 1)).toBe(2);
    expect(estimatePagesFromWords(WORDS_PER_PAGE * 10)).toBe(10);
    expect(estimatePagesFromWords(WORDS_PER_PAGE * 10 + 1)).toBe(11);
  });

  it("exposes the 10-page floor as 5000 words at 500 words/page", () => {
    expect(WORDS_PER_PAGE).toBe(500);
    expect(MIN_WORDS).toBe(5000);
  });

  it("counts words on whitespace", () => {
    expect(countWords("satu dua tiga")).toBe(3);
    expect(countWords("")).toBe(0);
    expect(countWords("  \n  satu   dua \n")).toBe(2);
  });
});

describe("subsection splitting + thinnest finder", () => {
  it("splits level-2 and level-3 headings with spans", () => {
    const subs = splitSubsections(MODULE);
    const headings = subs.map((s) => s.heading);
    expect(headings).toContain("Konsep A");
    expect(headings).toContain("Konsep B");
    // each subsection has a non-empty span in the source
    expect(MODULE.slice(subs[0].start, subs[0].end)).toContain("Tujuan Pembelajaran");
  });

  it("picks the thinnest *concept* subsection, ignoring the structural scaffold", () => {
    const thin = findThinnestSubsection(MODULE);
    expect(thin).not.toBeNull();
    // Konsep B (3 words) is thinner than Konsep A (5 words); structural headings excluded
    expect(thin!.heading).toBe("Konsep B");
  });

  it("replaces a subsection span in place", () => {
    const thin = findThinnestSubsection(MODULE)!;
    const replaced = replaceSubsection(MODULE, thin, "### Konsep B\nteks yang jauh lebih panjang sekarang ya");
    expect(replaced).toContain("teks yang jauh lebih panjang");
    expect(replaced).toContain("Konsep A"); // untouched
    expect(replaced).not.toContain("alpha beta gamma"); // old thin body gone
  });
});

describe("section completeness (independent of length)", () => {
  const COMPLETE = [
    "## Tujuan Pembelajaran",
    "- A",
    "## Mengapa topik ini penting",
    "pendek",
    "## Konsep kunci & definisi",
    "### Konsep A",
    "satu dua",
    "## Perbandingan",
    "x y",
    "## Rangkuman bab",
    "ringkas",
    "## Daftar istilah kunci",
    "glos",
  ].join("\n");

  const PARTIAL = [
    "## Tujuan Pembelajaran",
    "- A",
    "## Mengapa topik ini penting",
    "pendek",
    "## Konsep kunci & definisi",
    "### Konsep A",
    "satu dua",
    "## Perbandingan",
    "| Dimensi | Konsep A |",
    "| --- | --- |",
    "| Komunikasi | tim [1], [7], [9], [ |",
  ].join("\n");

  it("findMissingSections reports nothing for a complete module", () => {
    expect(findMissingSections(COMPLETE)).toEqual([]);
  });

  it("findMissingSections flags Rangkuman + glossary when absent", () => {
    const missing = findMissingSections(PARTIAL);
    expect(missing).toContain("rangkuman");
    expect(missing).toContain("glosarium");
  });

  it("detectTruncatedTail catches a dangling citation at the end (BUG 3 root cause)", () => {
    expect(detectTruncatedTail(PARTIAL)).toBe(true);
    expect(detectTruncatedTail(COMPLETE)).toBe(false);
    expect(detectTruncatedTail("kalimat normal yang selesai.")).toBe(false);
  });

  it("repairs truncation + appends missing sections before the length loop", async () => {
    const gen = vi.fn(async (opts: { prompt: string }) => {
      if (opts.prompt.includes("LANJUTKAN")) {
        return {
          text: "isi perbandingan lengkap.\n\n## Rangkuman bab\nRingkasan akhir modul.\n\n## Daftar istilah kunci\nGlosarium singkat.",
        };
      }
      return { text: "### Konsep A\n" + "kata ".repeat(40) };
    }) as unknown as ExpandGenerateFn;

    const res = await expandModuleUntilFloor(PARTIAL, gen, {
      system: "s",
      corpus: "CORPUS",
      title: "Topik",
      maxPasses: 2,
      maxCompletenessPasses: 3,
    });

    expect(res.complete).toBe(true);
    expect(res.finalText).toContain("Rangkuman bab");
    expect(res.finalText).toContain("Daftar istilah kunci");
    expect(detectTruncatedTail(res.finalText)).toBe(false);
    // The repair/append must have run (completeness pass), on top of any length pass.
    expect(gen).toHaveBeenCalled();
  });

  it("skips completeness entirely for non-module placeholder text (floor test stays clean)", async () => {
    const gen = vi.fn(async () => ({ text: "### Konsep\n" + "kata ".repeat(MIN_WORDS) })) as unknown as ExpandGenerateFn;
    await expandModuleUntilFloor("x ".repeat(MIN_WORDS), gen, { system: "s", corpus: "c", title: "t" });
    expect(gen).not.toHaveBeenCalled();
  });
});

describe("expandModuleUntilFloor", () => {
  const realWordCount = countWords(MODULE); // far below MIN_WORDS (5000)

  it("does not call generate when already at/above the floor", async () => {
    const generate = vi.fn() as unknown as ExpandGenerateFn;
    const res = await expandModuleUntilFloor(
      "x ".repeat(MIN_WORDS), // >= floor
      generate,
      { system: "s", corpus: "c", title: "t" },
    );
    expect(generate).not.toHaveBeenCalled();
    expect(res.passes).toBe(0);
    expect(res.metFloor).toBe(true);
  });

  it("issues a targeted second call for the thinnest subsection and stops after 2 passes", async () => {
    const calls: string[] = [];
    const generate = vi.fn(async (opts: { prompt: string }) => {
      calls.push(opts.prompt);
      // a small expansion that keeps the total under the floor, so the loop continues
      return { text: "### Konsep\n" + "kata ".repeat(40) };
    }) as unknown as ExpandGenerateFn;

    const res = await expandModuleUntilFloor(MODULE, generate, {
      system: "s",
      corpus: "CORPUS",
      title: "Topik",
      maxPasses: 2,
    });

    // bounded: exactly 2 passes, never an unbounded loop
    expect(res.passes).toBe(2);
    expect(generate).toHaveBeenCalledTimes(2);
    // each pass targeted the current thinnest concept subsection, by name
    expect(calls[0]).toContain("Konsep B");
    expect(calls[0]).toContain("CORPUS");
    expect(calls[1]).toContain("Konsep A"); // after B was expanded, A became thinnest
    // result still under floor -> honest "ringkas" signal, not a pretend pass
    expect(res.metFloor).toBe(false);
    expect(realWordCount).toBeLessThan(MIN_WORDS);
  });

  it("stops early once the floor is met (fewer than maxPasses calls)", async () => {
    const generate = vi.fn(async () => ({
      // a huge expansion that pushes the module over the floor in one pass
      text: "### Konsep\n" + "kata ".repeat(MIN_WORDS),
    })) as unknown as ExpandGenerateFn;

    const res = await expandModuleUntilFloor(MODULE, generate, {
      system: "s",
      corpus: "c",
      title: "t",
      maxPasses: 2,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(res.passes).toBe(1);
    expect(res.metFloor).toBe(true);
  });
});
