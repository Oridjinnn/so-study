// APA-7 reference formatting — pure string functions, no DB, no framework (I1/I3).
//
// Why this exists: modules used to render their grounding appendix as
// `Authors (Year). *Title*. url`, which is a display line, not a citation. A
// student pasting that into an essay bibliography would still have to rewrite
// every entry by hand — and an export that cannot be cited undermines the whole
// grounding chain (I5: an export must not launder a sourced module into an
// unsourced one). The bibliographic metadata the aggregator already merges
// (`src/lib/sources/types.ts` → doi/venue/volume/issue/pages/publisher/type) is
// exactly what APA-7 needs, so the reference is derived, never invented.
//
// Output is Markdown: journal names and book titles are italicised (`*…*`),
// article titles are not (APA-7 italicises the *container*, not the article).
// The Markdown export prints it verbatim; the PDF re-parses the `*…*` runs
// through `app/lib/markdownBlocks.parseInline`, so both paths render one string
// and can never drift apart.
//
// Consumed by `src/lib/export.ts` (Markdown) and `src/lib/pdf.ts` (PDF).

import { doiUrl, type PaperType } from "@/src/lib/sources/types";

/**
 * One work's bibliographic record, as far as it is known. Every field except
 * `title` is optional because real index records are incomplete: a preprint has
 * a DOI but no venue, a book has a publisher but no volume, an old record may
 * have no year at all. `null` is accepted alongside `undefined` throughout
 * because the export routes read nullable Prisma columns and map them with
 * `?? null`; both mean "not known" here.
 */
export interface ApaInput {
  /** Display string as stored, e.g. "Jane Doe, John Smith" or "Bourdieu, P.". */
  authors?: string | null;
  year?: number | null;
  title: string;
  doi?: string | null;
  /** Journal/container title. Absent for books and most preprints. */
  venue?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publisher?: string | null;
  type?: PaperType | null;
  /** Provider link; used only when there is no DOI. */
  sourceUrl?: string | null;
}

/**
 * A token that is initials rather than a name: "P.", "J. M.", "J.-C.".
 * Used to undo the comma split below (see `toApaAuthors`). Deliberately ASCII
 * `[A-Z]` rather than `\p{Lu}`: this file compiles at `target: ES2017`, where
 * TS rejects Unicode property escapes.
 */
const INITIALS_ONLY = /^(?:[A-Z]\.?)(?:[\s-]*[A-Z]\.?)*$/;

/** Collapses runs of whitespace so an omitted field cannot leave a gap. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Converts one name to APA-7 "Family, I. I." form.
 *
 * A name that already contains a comma is assumed to be inverted already
 * ("Bourdieu, P.") and is kept as-is — re-parsing it would only risk mangling
 * it. Otherwise the name is read as "Given Family", split on its LAST space, so
 * every leading word becomes an initial: "Jane Marie Doe" → "Doe, J. M.". This
 * is name-order-agnostic in the only way a display string allows, and it handles
 * the Indonesian two-word case the app cares about: "Budi Santoso" →
 * "Santoso, B.". A mononym ("Plato") has no space to split on and is kept whole.
 */
function toApaName(name: string): string {
  const clean = collapse(name);
  if (!clean) return "";
  if (clean.includes(",")) return clean;

  const cut = clean.lastIndexOf(" ");
  if (cut < 0) return clean;

  const given = clean.slice(0, cut);
  const family = clean.slice(cut + 1);
  const initials = given
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}.`)
    .join(" ");
  return initials ? `${family}, ${initials}` : family;
}

/**
 * Renders a stored author display string as an APA-7 author list.
 *
 * Accepts the separators providers actually emit — ",", " and ", " & " — and
 * returns "" for a missing/empty string so the caller can just interpolate it.
 *
 * The comma is both an author separator ("Jane Doe, John Smith") and part of an
 * already-inverted name ("Bourdieu, P."), so after splitting we re-join a token
 * that is pure initials onto the surname before it. Without that, "Bourdieu, P."
 * would be read as two authors.
 *
 * Names are joined with ", " and the final name gets ", & " (APA-7 keeps the
 * serial comma before the ampersand); a lone author gets no ampersand.
 */
export function toApaAuthors(display?: string | null): string {
  if (!display) return "";

  const tokens = display
    .split(/\s*,\s*|\s+and\s+|\s*&\s*/)
    .map((t) => t.trim())
    .filter(Boolean);

  const rejoined: string[] = [];
  for (const token of tokens) {
    const prev = rejoined[rejoined.length - 1];
    if (prev && !prev.includes(",") && INITIALS_ONLY.test(token)) {
      rejoined[rejoined.length - 1] = `${prev}, ${token}`;
    } else {
      rejoined.push(token);
    }
  }

  const names = rejoined.map(toApaName).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

/**
 * Formats one work as an APA-7 reference-list entry, WITHOUT a leading list
 * number (the caller owns numbering so the module's inline `[n]` markers keep
 * resolving).
 *
 * Three shapes, chosen by the metadata that is actually present:
 *   - book (`type === "book"`)  → `Author. (Year). *Title*. Publisher. url`
 *   - has a `venue`            → `Author. (Year). Title. *Journal*, vol(iss). pages. url`
 *   - neither (preprint, report, bare record)
 *                              → `Author. (Year). Title. url`
 *
 * The link is the DOI when there is one (canonical, `https://doi.org/…` via
 * `doiUrl`) and the provider URL otherwise. A missing year becomes `(n.d.)`
 * rather than a fake one, and a missing field never leaves a stray separator
 * behind: whitespace is collapsed at the end.
 */
export function formatAPA(p: ApaInput): string {
  const authors = toApaAuthors(p.authors);
  const yearOut = p.year && p.year > 0 ? `(${p.year}).` : "(n.d.).";
  const title = (p.title ?? "").trim();

  const link = doiUrl(p.doi) ?? (p.sourceUrl ? p.sourceUrl.trim() : "");
  const url = link ? ` ${link}` : "";

  if (p.type === "book") {
    const publisher = p.publisher?.trim();
    // Without a publisher the trailing ". " would be a dangling separator.
    return collapse(
      publisher
        ? `${authors} ${yearOut} *${title}*. ${publisher}.${url}`
        : `${authors} ${yearOut} *${title}*.${url}`,
    );
  }

  const venue = p.venue?.trim();
  if (venue) {
    const volume = p.volume?.trim();
    const issue = p.issue?.trim();
    const volIss = volume ? `, ${volume}${issue ? `(${issue})` : ""}` : "";
    const pages = p.pages?.trim();
    // APA-7 uses an en dash for page ranges (45–67), not a hyphen.
    const pagesDash = pages ? pages.replace(/(\d+)\s*-\s*(\d+)/g, "$1–$2") : "";
    const tail = pagesDash ? `, ${pagesDash}.` : ".";
    return collapse(`${authors} ${yearOut} ${title}. *${venue}*${volIss}${tail}${url}`);
  }

  return collapse(`${authors} ${yearOut} ${title}.${url}`);
}
