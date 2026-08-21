import { describe, expect, it } from "vitest";
import {
  GUARD_STATUS,
  LIMITS,
  firstGuardError,
  guardBodyBytes,
  guardChars,
  guardCount,
  guardLength,
  totalLength,
} from "./guards";

describe("guardLength", () => {
  it("passes a value exactly at the limit", () => {
    expect(guardLength("question", "Pertanyaan", "x".repeat(10), 10)).toBeNull();
  });

  it("rejects a value one character over the limit", () => {
    const err = guardLength("question", "Pertanyaan", "x".repeat(11), 10);
    expect(err).not.toBeNull();
    expect(err?.field).toBe("question");
    expect(err?.limit).toBe(10);
    expect(err?.actual).toBe(11);
    expect(err?.unit).toBe("karakter");
  });

  it("names the field in a message the student can act on", () => {
    const err = guardLength("studentAnswer", "Jawaban esai", "x".repeat(5), 1);
    expect(err?.error).toContain("Jawaban esai");
    expect(err?.error).toContain("maksimum 1");
  });

  it("treats null and undefined as length zero", () => {
    expect(guardLength("rubric", "Rubrik", null, 0)).toBeNull();
    expect(guardLength("rubric", "Rubrik", undefined, 0)).toBeNull();
  });

  it("passes an empty string", () => {
    expect(guardLength("rubric", "Rubrik", "", 10)).toBeNull();
  });
});

describe("guardChars", () => {
  it("passes a measured count at the limit", () => {
    expect(guardChars("chunksTotal", "Konteks", 100, 100)).toBeNull();
  });

  it("rejects a measured count over the limit", () => {
    expect(guardChars("chunksTotal", "Konteks", 101, 100)?.actual).toBe(101);
  });
});

describe("guardCount", () => {
  it("passes a collection at the limit", () => {
    expect(guardCount("chunks", "Cuplikan modul", 5, 5)).toBeNull();
  });

  it("rejects a collection over the limit and reports items", () => {
    const err = guardCount("chunks", "Cuplikan modul", 6, 5);
    expect(err?.unit).toBe("item");
    expect(err?.actual).toBe(6);
  });

  it("phrases a count violation as 'terlalu banyak', not 'terlalu besar'", () => {
    expect(guardCount("chunks", "Cuplikan modul", 6, 5)?.error).toContain("terlalu banyak");
    expect(guardLength("question", "Pertanyaan", "xx", 1)?.error).toContain("terlalu besar");
  });
});

describe("guardBodyBytes", () => {
  it("passes when Content-Length is absent (nothing was declared)", () => {
    expect(guardBodyBytes(null)).toBeNull();
    expect(guardBodyBytes(undefined)).toBeNull();
    expect(guardBodyBytes("")).toBeNull();
  });

  it("passes a body inside the ceiling", () => {
    expect(guardBodyBytes("1000")).toBeNull();
  });

  it("rejects a body over the ceiling", () => {
    const err = guardBodyBytes(String(LIMITS.bodyBytes + 1));
    expect(err?.field).toBe("body");
    expect(err?.unit).toBe("bita");
  });

  it("ignores an unparseable or negative Content-Length instead of guessing", () => {
    expect(guardBodyBytes("not-a-number")).toBeNull();
    expect(guardBodyBytes("-5")).toBeNull();
  });

  it("honours an explicit limit override", () => {
    expect(guardBodyBytes("11", 10)?.limit).toBe(10);
  });
});

describe("firstGuardError", () => {
  it("returns null when every check passed", () => {
    expect(firstGuardError(null, null, null)).toBeNull();
  });

  it("returns the first violation in evaluation order", () => {
    const first = guardLength("a", "A", "xx", 1);
    const second = guardLength("b", "B", "xxx", 1);
    expect(firstGuardError(null, first, second)?.field).toBe("a");
  });
});

describe("totalLength", () => {
  it("sums the characters of every chunk", () => {
    expect(totalLength(["abc", "de", ""])).toBe(5);
  });

  it("is zero for no chunks", () => {
    expect(totalLength([])).toBe(0);
  });
});

describe("LIMITS", () => {
  it("uses 413 Content Too Large for every length rejection", () => {
    expect(GUARD_STATUS).toBe(413);
  });

  it("leaves real study-sized input comfortably inside the ceilings", () => {
    // A synthesized module is capped at 4096 output tokens (~16k chars);
    // guards must not fire on a normal module or a long essay.
    expect(LIMITS.moduleText).toBeGreaterThan(16_000 * 2);
    expect(LIMITS.chunksTotal).toBeGreaterThan(16_000 * 2);
    expect(LIMITS.studentAnswer).toBeGreaterThan(3_000 * 6);
  });
});
