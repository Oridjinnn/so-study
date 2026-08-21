import { describe, expect, it } from "vitest";
import { buildSystem } from "./route";

// Change 1 requires the jurusan to be *behavioural*, not a stored label: the
// synthesis prompt must actually carry the disciplinary lens, otherwise the same
// approved papers produce the same generic module for every major.
describe("buildSystem — disciplinary framing", () => {
  it("names the course in the system prompt", () => {
    expect(buildSystem("Teori Antropologi Kontemporer")).toContain(
      "Teori Antropologi Kontemporer",
    );
  });

  it("injects the major as an explicit disciplinary lens", () => {
    const withMajor = buildSystem("Teori Antropologi Kontemporer", "Antropologi");
    expect(withMajor).toContain("Antropologi");
    expect(withMajor.toLowerCase()).toContain("jurusan");
    // Explicitly instructs against the generic cross-disciplinary summary.
    expect(withMajor.toLowerCase()).toContain("lintas-disiplin");
  });

  it("produces a different prompt per major for the same course", () => {
    const a = buildSystem("Teori Sosial", "Antropologi");
    const b = buildSystem("Teori Sosial", "Sosiologi");
    expect(a).not.toBe(b);
    expect(b).toContain("Sosiologi");
    expect(b).not.toContain("Antropologi");
  });

  it("omits the framing block entirely when the course has no major", () => {
    const none = buildSystem("Teori Sosial");
    expect(none.toLowerCase()).not.toContain("jurusan");
    expect(none).not.toContain("undefined");
  });

  it("keeps the grounding + citation invariants regardless of major", () => {
    // The major must never displace the anti-hallucination instructions (I5).
    for (const prompt of [buildSystem("MK"), buildSystem("MK", "Antropologi")]) {
      expect(prompt).toContain("HANYA informasi dari paper yang diberikan");
      expect(prompt).toContain("Sitasi inline WAJIB");
      expect(prompt).toContain("Sources:");
    }
  });
});
