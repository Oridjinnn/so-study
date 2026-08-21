// PART 4 — targeted, not blind, regeneration.
//
// ---------------------------------------------------------------------------
// THE PRINCIPLE: the harness diagnoses, the model does a NARROW fix.
// ---------------------------------------------------------------------------
// When the student asks to improve a module, we do NOT send "improve this
// module". That throws away everything the two tiers just learned and pays for a
// full rewrite that can regress the parts that were fine. Instead we build the
// request FROM the specific flags — Tier 1 WARN items and Tier 2
// "uncertain"/"contradicted" verdicts — and quote back, per claim: the exact
// flagged sentence, WHY it was flagged, and the cited paper's actual text. The
// model is asked to do one of three concrete things to THAT claim: correct it,
// cite it properly, or remove it if the source cannot support it. Same shape as
// the length-expansion pass (src/lib/pages.ts): a small, well-scoped call.
//
// Bounds (cost + anti-loop, reusing the 2-attempt cap pattern):
//   - Nothing to fix → no call at all. A clean module must never trigger a
//     costly no-op "regeneration"; the caller shows "already passed" instead.
//   - At most MAX_REPAIR_ATTEMPTS passes. If flags remain after that, they are
//     surfaced plainly as "belum bisa diperbaiki otomatis, tinjau manual"
//     rather than looping forever.

import { z } from "zod";
import type { CriticFlag } from "./critic";
import type { GeminiResponseSchema } from "./gemini";
import type { Tier1Finding, Tier1Source } from "./tier1";

/** Reuse the existing 2-attempt cap pattern from the essay/length work. */
export const MAX_REPAIR_ATTEMPTS = 2;

/** A single thing to fix, resolved to the source text needed to fix it. */
export interface RepairItem {
  claimText: string;
  /** "tier1" (deterministic WARN) or "tier2" (AI critic verdict). */
  origin: "tier1" | "tier2";
  reason: string;
  /** The cited paper id, when the flag is tied to one. */
  citedPaperId: string | null;
  paperTitle: string | null;
  /** The cited paper's stored text — the ground the fix must stay within. */
  paperText: string | null;
}

/**
 * Turn the two tiers' flags into a de-duplicated, source-resolved repair list.
 *
 * - Tier 1 `fail` findings (phantom citations) ARE included: a hard-blocked
 *   module is exactly what the student needs fixed, and correcting/removing the
 *   phantom `[n]` is a legitimate narrow edit.
 * - Tier 2 "supported" verdicts are excluded — there is nothing to fix.
 * - Same claim flagged by both tiers collapses to one item (the reasons are
 *   concatenated) so the model is not asked to fix the same sentence twice.
 */
export function collectRepairItems(
  tier1Findings: Tier1Finding[],
  criticFlags: CriticFlag[],
  sources: Tier1Source[],
): RepairItem[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const items = new Map<string, RepairItem>();

  const resolve = (paperId: string | null) => {
    const src = paperId ? byId.get(paperId) : undefined;
    return {
      citedPaperId: paperId,
      paperTitle: src?.title ?? null,
      paperText: src?.text ?? null,
    };
  };

  const keyFor = (claimText: string) => claimText.trim().toLowerCase();

  for (const f of tier1Findings) {
    const key = keyFor(f.claimText);
    const existing = items.get(key);
    if (existing) {
      existing.reason = `${existing.reason}; ${f.reason}`;
      continue;
    }
    items.set(key, {
      claimText: f.claimText,
      origin: "tier1",
      reason: f.reason,
      ...resolve(f.citedPaperId),
    });
  }

  for (const f of criticFlags) {
    if (f.verdict === "supported") continue;
    const key = keyFor(f.claimText);
    const reason = `kritikus AI menilai "${f.verdict}": ${f.note}`;
    const existing = items.get(key);
    if (existing) {
      existing.reason = `${existing.reason}; ${reason}`;
      if (!existing.paperText) Object.assign(existing, resolve(f.citedPaperId));
      continue;
    }
    items.set(key, {
      claimText: f.claimText,
      origin: "tier2",
      reason,
      ...resolve(f.citedPaperId),
    });
  }

  return [...items.values()];
}

const MAX_SOURCE_CHARS = 2_000;

/** System prompt for the repair pass — a narrow editor, not a fresh author. */
export function buildRepairSystem(courseName: string, major?: string): string {
  return `Kamu adalah editor modul belajar untuk mata kuliah "${courseName}".${
    major ? `\nJurusan (disiplin) mahasiswa: "${major}". Pertahankan lensa disiplin ${major}.` : ""
  }
Tugasmu BUKAN menulis ulang modul. Kamu memperbaiki HANYA klaim-klaim bermasalah yang diberikan, satu per satu, dengan mengubah SESEDIKIT mungkin. Untuk setiap klaim, pilih SATU tindakan: (a) perbaiki agar sesuai teks sumber, (b) beri/renovasi sitasi [n] yang benar, atau (c) hapus klaim bila teks sumber tidak dapat mendukungnya. Gunakan HANYA teks sumber yang diberikan; jangan menambah teori dari luar. Pertahankan Bahasa Indonesia dan gaya penulisan asli.`;
}

/**
 * Build the targeted repair prompt. It MUST carry, per flagged claim: the exact
 * claim text, the reason it was flagged, and the cited source's real content —
 * that specificity is what makes this a targeted fix instead of a blind rewrite,
 * and it is asserted directly in the tests.
 */
export function buildRepairPrompt(items: RepairItem[]): string {
  const blocks = items.map((it, i) => {
    const src = it.paperText
      ? it.paperText.length > MAX_SOURCE_CHARS
        ? `${it.paperText.slice(0, MAX_SOURCE_CHARS)}…`
        : it.paperText
      : "(teks sumber tidak tersedia — jika klaim tak bisa diverifikasi, hapus klaim itu)";
    return [
      `<<<MASALAH ${i + 1} START>>>`,
      `index: ${i + 1}`,
      `Klaim bermasalah: ${it.claimText}`,
      `Alasan ditandai: ${it.reason}`,
      it.citedPaperId
        ? `Paper yang disitir: ${it.citedPaperId}`
        : "Paper yang disitir: (tidak ada — sitasi hantu)",
      it.paperTitle ? `Judul sumber: ${it.paperTitle}` : "",
      `Teks sumber sebenarnya: ${src}`,
      `<<<MASALAH ${i + 1} END>>>`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return (
    `Perbaiki ${items.length} klaim bermasalah berikut. Untuk SETIAP klaim, ambil SATU tindakan: ` +
    `"diperbaiki" (ubah isi klaim agar sesuai teks sumber), "disitir" (benahi/lengkapi penanda sitasi [n]), ` +
    `atau "dihapus" (klaim tidak dapat didukung teks sumber).\n\n` +
    `${blocks.join("\n\n")}\n\n` +
    `Kembalikan array JSON: satu entri per masalah dengan field index (sesuai nomor MASALAH), action, dan ` +
    `revisedText (kalimat pengganti lengkap dalam Bahasa Indonesia, pertahankan penanda sitasi [n] yang benar; ` +
    `kosongkan bila action = "dihapus"). Jangan menulis ulang bagian modul yang tidak disebut di sini.`
  );
}

/** `responseSchema` for the repair call (JSON mode — no fenced-prose parsing). */
export const REPAIR_RESPONSE_SCHEMA: GeminiResponseSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      index: { type: "integer" },
      action: { type: "string", enum: ["diperbaiki", "disitir", "dihapus"] },
      revisedText: { type: "string" },
    },
    required: ["index", "action", "revisedText"],
  },
};

const RevisionSchema = z.object({
  index: z.number().int(),
  action: z.enum(["diperbaiki", "disitir", "dihapus"]),
  revisedText: z.string(),
});
const RevisionBatchSchema = z.union([
  z.array(RevisionSchema),
  z.object({ revisions: z.array(RevisionSchema) }).transform((o) => o.revisions),
]);

export interface RepairRevision {
  /** The MASALAH number (1-based) the revision answers. */
  index: number;
  /** The original flagged claim, used for in-place replacement in the module. */
  originalClaim: string;
  /** The revised sentence, or empty when the model removed the claim. */
  revisedText: string;
  removed: boolean;
}

/**
 * Parse the repair output back into per-claim revisions aligned to `items`.
 *
 * Primary path is the JSON schema above. The numbered-text fallback exists
 * because a schema constrains the shape of a SUCCESSFUL response, not what
 * arrives when the model or the transport misbehaves — and a wasted paid call is
 * worth ten lines of tolerance. Tolerant by design: a claim the model skipped is
 * left unrevised, so it stays flagged and the bounded loop surfaces it for manual
 * review instead of silently dropping it.
 */
export function parseRepairResponse(text: string, items: RepairItem[]): RepairRevision[] {
  const fromJson = parseJsonRevisions(text, items);
  if (fromJson.length > 0) return fromJson;
  return parseNumberedRevisions(text, items);
}

function toRevision(
  index: number,
  action: "diperbaiki" | "disitir" | "dihapus",
  revisedText: string,
  items: RepairItem[],
): RepairRevision | null {
  const item = items[index - 1];
  if (!item) return null;
  const removed = action === "dihapus";
  return {
    index,
    originalClaim: item.claimText,
    revisedText: removed ? "" : revisedText.trim(),
    removed,
  };
}

function parseJsonRevisions(text: string, items: RepairItem[]): RepairRevision[] {
  let parsed: z.infer<typeof RevisionSchema>[];
  try {
    parsed = RevisionBatchSchema.parse(JSON.parse(text));
  } catch {
    return [];
  }
  const out: RepairRevision[] = [];
  for (const r of parsed) {
    const rev = toRevision(r.index, r.action, r.revisedText, items);
    if (rev) out.push(rev);
  }
  return out;
}

function parseNumberedRevisions(text: string, items: RepairItem[]): RepairRevision[] {
  const revisions: RepairRevision[] = [];
  const re = /^\s*(\d+)[.)]\s*/gm;
  const marks: { index: number; at: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    marks.push({ index: Number(m[1]), at: m.index, end: re.lastIndex });
  }
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    const bodyEnd = i + 1 < marks.length ? marks[i + 1].at : text.length;
    const body = text.slice(cur.end, bodyEnd).trim();
    const removed = /^\[DIHAPUS\]/i.test(body);
    const rev = toRevision(
      cur.index,
      removed ? "dihapus" : "diperbaiki",
      removed ? "" : body,
      items,
    );
    if (rev) revisions.push(rev);
  }
  return revisions;
}

/**
 * Apply parsed revisions to the module markdown by literal claim replacement.
 * A removed claim is deleted; a revised claim is substituted in place. Only the
 * flagged sentences are touched — everything else is byte-for-byte unchanged,
 * which is the whole point of a targeted pass.
 *
 * Returns the claim texts that no longer exist afterwards (`staleClaimTexts`) so
 * `mergeCriticReports` can forget their verdicts instead of keeping stale flags
 * about sentences that are gone, plus the replacement texts (`revisedTexts`) —
 * the ONLY claims Tier 2 needs to re-judge after a repair pass.
 */
export function applyRepairs(
  markdown: string,
  revisions: RepairRevision[],
): {
  markdown: string;
  staleClaimTexts: string[];
  revisedTexts: string[];
  applied: number;
} {
  let out = markdown;
  const staleClaimTexts: string[] = [];
  const revisedTexts: string[] = [];
  let applied = 0;
  for (const rev of revisions) {
    if (!rev.originalClaim || !out.includes(rev.originalClaim)) continue;
    if (rev.removed) {
      out = out.replace(rev.originalClaim, "");
      staleClaimTexts.push(rev.originalClaim);
      applied += 1;
    } else if (rev.revisedText && rev.revisedText !== rev.originalClaim) {
      out = out.replace(rev.originalClaim, rev.revisedText);
      staleClaimTexts.push(rev.originalClaim);
      revisedTexts.push(rev.revisedText);
      applied += 1;
    }
  }
  // Collapse blank-line runs a removal left behind, without disturbing prose.
  out = out.replace(/\n{3,}/g, "\n\n");
  return { markdown: out, staleClaimTexts, revisedTexts, applied };
}
