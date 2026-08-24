import { describe, expect, it } from "vitest";
import { normalizeModule } from "./normalize";

describe("normalizeModule — TIngkatan casing (rule 1)", () => {
  it("fixes the broken 'TIngkatan' casing from the real PDF", () => {
    const input = "# TIngkatan aktor dan level hukum yang terikat pada aktor";
    expect(normalizeModule(input)).toBe(
      "# Tingkatan Aktor dan Level Hukum yang Terikat pada Aktor",
    );
  });

  it("leaves already-correct 'Tingkatan'/'tingkatan' (body text) untouched", () => {
    expect(normalizeModule("Tingkatan aktor")).toBe("Tingkatan aktor");
    expect(normalizeModule("tingkatan aktor")).toBe("tingkatan aktor");
  });
});

describe("normalizeModule — state-centric spacing (rule 2)", () => {
  it("collapses 'state- centric' (space before hyphen)", () => {
    const input =
      "Pendekatan ini bersifat state- centric dalam membaca hukum internasional.";
    expect(normalizeModule(input)).toBe(
      "Pendekatan ini bersifat state-centric dalam membaca hukum internasional.",
    );
  });

  it("handles 'state -centric', 'state - centric', and en/em dash variants", () => {
    expect(normalizeModule("a state -centric b")).toBe("a state-centric b");
    expect(normalizeModule("a state - centric b")).toBe("a state-centric b");
    expect(normalizeModule("a state–centric b")).toBe("a state-centric b");
    expect(normalizeModule("a state—centric b")).toBe("a state-centric b");
  });

  it("leaves a correctly written 'state-centric' alone (idempotency-friendly)", () => {
    expect(normalizeModule("state-centric")).toBe("state-centric");
  });
});

describe("normalizeModule — brand token (rule 3)", () => {
  it("normalizes a 'So-study' header line and title-cases the title", () => {
    const input = "So-study — Tingkatan aktor dan level hukum yang terikat pada aktor";
    expect(normalizeModule(input)).toBe(
      "So-Study — Tingkatan Aktor dan Level Hukum yang Terikat pada Aktor",
    );
  });

  it("normalizes lowercase and uppercase brand variants at line start", () => {
    expect(normalizeModule("so-study — Modul")).toBe("So-Study — Modul");
    expect(normalizeModule("SO-STUDY — Modul")).toBe("So-Study — Modul");
  });

  it("normalizes the brand inside a footer phrase", () => {
    expect(normalizeModule("Diekspor dari So-study")).toBe(
      "Diekspor dari So-Study",
    );
    expect(normalizeModule("Diekspor dari so-study")).toBe(
      "Diekspor dari So-Study",
    );
  });

  it("does NOT touch a mid-sentence 'So-study' use", () => {
    const input = "Kami belajar lewat So-study setiap hari.";
    expect(normalizeModule(input)).toBe(input);
  });
});

describe("normalizeModule — title-casing (rule 4)", () => {
  it("title-cases the first H1 heading", () => {
    expect(normalizeModule("# tingkatan aktor dan level hukum")).toBe(
      "# Tingkatan Aktor dan Level Hukum",
    );
  });

  it("preserves proper nouns like HI, Non-State, Street-Level, Hukum Internasional", () => {
    expect(normalizeModule("# non-state actor dan hukum internasional")).toBe(
      "# Non-State Actor dan Hukum Internasional",
    );
    expect(normalizeModule("# street-level bureaucracy dan HI")).toBe(
      "# Street-Level Bureaucracy dan HI",
    );
  });

  it("does not touch section headings (## )", () => {
    expect(normalizeModule("## tingkatan aktor")).toBe("## tingkatan aktor");
  });
});

describe("normalizeModule — untouchables (rule 6)", () => {
  it("leaves inline citations like [1][4][5] untouched", () => {
    const input =
      "Neorealisme menekankan negara [1][4][5] sebagai unit utama.";
    expect(normalizeModule(input)).toBe(input);
  });

  it("leaves a DOI / URL untouched", () => {
    const input =
      "Lihat https://doi.org/10.1234/abc.2024.001 dan https://example.com/x.";
    expect(normalizeModule(input)).toBe(input);
  });

  it("does not alter academic terms or numbers", () => {
    const input = "Terdapat 12 aktor Non-State pada tier-2 tahun 1999.";
    expect(normalizeModule(input)).toBe(input);
  });
});

describe("normalizeModule — idempotency (rule 5)", () => {
  const samples = [
    "# TIngkatan aktor dan level hukum yang terikat pada aktor",
    "So-study — Tingkatan aktor dan level hukum yang terikat pada aktor",
    "Pendekatan state- centric dan state –centric digunakan [1][2].",
    "Diekspor dari So-study",
    "Kami belajar lewat So-study setiap hari. Lihat https://doi.org/10.1/a [3].",
  ];

  for (const sample of samples) {
    it(`is idempotent for: ${sample.slice(0, 40)}`, () => {
      const once = normalizeModule(sample);
      const twice = normalizeModule(once);
      expect(twice).toBe(once);
    });
  }

  it("normalizes then re-normalizing a full realistic snippet is stable", () => {
    const md = [
      "So-study — TIngkatan aktor dan level hukum yang terikat pada aktor",
      "",
      "## Pengantar",
      "",
      "Negara bersifat state- centric [1][4][5] dalam hukum internasional.",
      "Lihat https://doi.org/10.1234/hi.2024 untuk detail.",
      "",
      "Diekspor dari So-study",
    ].join("\n");
    const once = normalizeModule(md);
    expect(normalizeModule(once)).toBe(once);
  });
});
