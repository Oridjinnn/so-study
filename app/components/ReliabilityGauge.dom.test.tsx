import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ReliabilityGauge from "./ReliabilityGauge";
import type { VerificationPayload } from "../lib/types";
import type { GaugeResult, GaugeBreakdown } from "@/src/lib/gauge";

function breakdown(over: Partial<GaugeBreakdown> = {}): GaugeBreakdown {
  return {
    citationsTotal: 40, citationsValid: 40, citationsPhantom: 0,
    claimsTotal: 30, uncitedClaims: 4, uncitedRatio: 0.1333, uncitedThreshold: 0.3, uncitedOverThreshold: false,
    entitiesChecked: 20, entitiesMismatched: 0,
    criticRan: true, criticJudged: 10, criticSupported: 10, criticUncertain: 0, criticContradicted: 0,
    aiFlagged: 0, ...over,
  };
}

function gauge(over: Partial<GaugeResult> = {}): GaugeResult {
  return {
    score: 1, band: "baik", blocked: false,
    breakdown: breakdown(),
    breakdownLines: [
      "Sitasi valid: 40/40 (0 hantu)",
      "Klaim tanpa sitasi: 4 dari 30 — ambang 30% — di bawah ambang",
      "Entitas/angka dekat sitasi tidak ditemukan di sumber: 0",
      "Ditandai AI untuk ditinjau: 0",
    ],
    caveat:
      "Skor ini mengukur seberapa baik klaim modul terhubung ke sumbernya — bukan jaminan semua interpretasi teoritis 100% akurat. Klaim yang ditandai masih perlu ditinjau manusia.",
    flagCount: 0, ...over,
  };
}

function payload(over: Partial<VerificationPayload> = {}): VerificationPayload {
  // In real usage a gauge only exists when Tier 1 has run (verificationPayload
  // sets gauge:null when tier1 is null), so tier1 is paired with the gauge here.
  return { tier1, critic: null, gauge: gauge(), verifiedAt: null, repairAttempts: 0, ...over };
}

const tier1 = {
  passed: true, blocked: false,
  citations: { total: 40, valid: 40, phantom: 0 },
  claims: { total: 30, uncited: 4, ratio: 0.1333, threshold: 0.3, overThreshold: false },
  entities: { checked: 20, mismatched: 0 }, findings: [],
};

describe("<ReliabilityGauge /> — the number never travels alone", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("says the module is unverified, not clean, when no gauge exists", () => {
    render(<ReliabilityGauge moduleId="m1" verification={payload({ gauge: null, tier1: null })} online />);
    expect(screen.getAllByText(/belum diperiksa/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("always renders the caveat as body text, not only a tooltip", () => {
    render(<ReliabilityGauge moduleId="m1" verification={payload()} online />);
    const caveat = screen.getByText(/bukan jaminan semua interpretasi teoritis 100% akurat/i);
    expect(caveat.tagName).toBe("P");
    // It is on the page in plain sight, not tucked behind a title attribute.
    expect(caveat.closest("[title]")).toBeNull();
  });

  it("exposes the score as an accessible meter with the band in its label", () => {
    render(<ReliabilityGauge moduleId="m1" verification={payload()} online />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "100");
    expect(meter.getAttribute("aria-label")).toContain("Baik — lolos kedua tahap");
    expect(screen.getAllByText(/Baik/).length).toBeGreaterThan(0);
  });

  it("lists the breakdown components next to the needle", () => {
    render(<ReliabilityGauge moduleId="m1" verification={payload()} online />);
    expect(screen.getByText(/Sitasi valid: 40\/40/)).toBeInTheDocument();
    expect(screen.getByText(/Klaim tanpa sitasi: 4 dari 30/)).toBeInTheDocument();
  });

  it("does NOT offer regeneration when nothing is flagged", () => {
    render(<ReliabilityGauge moduleId="m1" verification={payload()} online />);
    expect(screen.queryByRole("button", { name: /Kembangkan lebih lagi/i })).not.toBeInTheDocument();
    expect(screen.getByText(/sudah lolos Tahap 1/i)).toBeInTheDocument();
  });

  it("announces the hard block and withholds the reader", () => {
    render(
      <ReliabilityGauge
        moduleId="m1"
        verification={payload({
          tier1: { ...tier1, blocked: true, passed: false, citations: { total: 40, valid: 39, phantom: 1 } },
          gauge: gauge({ score: 0.975, band: "ditahan", blocked: true, flagCount: 0,
            breakdown: breakdown({ citationsValid: 39, citationsPhantom: 1 }) }),
        })}
        online
      />,
    );
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(/Modul ditahan/i)).toBeInTheDocument();
    // A blocked module is not "fixable" via the soft regenerate button.
    expect(screen.queryByRole("button", { name: /Kembangkan lebih lagi/i })).not.toBeInTheDocument();
  });

  it("offers a TARGETED repair (not a full rewrite) when flags exist", () => {
    render(
      <ReliabilityGauge
        moduleId="m1"
        verification={payload({
          tier1: { ...tier1, findings: [{ check: "entity_grounding", severity: "warn", claimText: "X [1]", n: 1, citedPaperId: "p1", reason: "r" }] },
          gauge: gauge({ band: "cukup", flagCount: 1, breakdown: breakdown({ entitiesMismatched: 1 }) }),
        })}
        online
      />,
    );
    const btn = screen.getByRole("button", { name: /Kembangkan lebih lagi/i });
    expect(btn).toBeInTheDocument();
    // The explanation states what the repair actually does — surgical, not generic.
    expect(screen.getByText(/hanya menyasar klaim bertanda itu/i)).toBeInTheDocument();
    expect(screen.getByText(/bukan menulis ulang seluruh modul/i)).toBeInTheDocument();
  });

  it("shows the remaining-attempt budget next to the repair button", () => {
    render(
      <ReliabilityGauge
        moduleId="m1"
        verification={payload({
          repairAttempts: 1,
          tier1: { ...tier1, findings: [{ check: "entity_grounding", severity: "warn", claimText: "X [1]", n: 1, citedPaperId: "p1", reason: "r" }] },
          gauge: gauge({ band: "cukup", flagCount: 1, breakdown: breakdown({ entitiesMismatched: 1 }) }),
        })}
        online
      />,
    );
    expect(screen.getByText(/Sisa percobaan otomatis: 1 dari 2/i)).toBeInTheDocument();
  });

  it("drops the button and asks for manual review once the budget is spent", () => {
    render(
      <ReliabilityGauge
        moduleId="m1"
        verification={payload({
          repairAttempts: 2,
          tier1: { ...tier1, findings: [{ check: "entity_grounding", severity: "warn", claimText: "X [1]", n: 1, citedPaperId: "p1", reason: "r" }] },
          gauge: gauge({ band: "cukup", flagCount: 1, breakdown: breakdown({ entitiesMismatched: 1 }) }),
        })}
        online
      />,
    );
    expect(screen.queryByRole("button", { name: /Kembangkan lebih lagi/i })).not.toBeInTheDocument();
    expect(screen.getByText(/belum bisa diperbaiki otomatis, tinjau manual/i)).toBeInTheDocument();
  });

  it("calls the targeted repair endpoint and reports back via callbacks", async () => {
    const onVerification = vi.fn();
    const onContentChanged = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, changed: true, verification: payload({ gauge: gauge({ score: 1 }) }) }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ReliabilityGauge
        moduleId="m1"
        verification={payload({
          tier1: { ...tier1, findings: [{ check: "entity_grounding", severity: "warn", claimText: "X [1]", n: 1, citedPaperId: "p1", reason: "r" }] },
          gauge: gauge({ band: "cukup", flagCount: 1, breakdown: breakdown({ entitiesMismatched: 1 }) }),
        })}
        online
        onVerification={onVerification}
        onContentChanged={onContentChanged}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Kembangkan lebih lagi/i }));
    // The request goes to the targeted endpoint, with NO body — it rebuilds the
    // flags server-side rather than trusting anything from the client.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/modules/m1/repair", expect.objectContaining({ method: "POST", body: "{}" })));
    await vi.waitFor(() => expect(onVerification).toHaveBeenCalled());
    expect(onContentChanged).toHaveBeenCalled();
  });
});
