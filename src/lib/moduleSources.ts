// DB-side loader shared by the accuracy-verification routes.
//
// Contract (rule I4 — the human approval gate is an invariant): the sources a
// citation may resolve to are the APPROVED papers of the module's topic, in the
// module's own `sourcePaperIds` order. That order IS the citation index — `[1]`
// is `sourcePaperIds[0]` — and approval is checked here rather than trusted from
// the stored id list, so a paper the student later un-approved correctly turns
// its citations into Tier 1 phantoms instead of quietly staying "verified".

import { prisma } from "./prisma";
import type { Tier1Source } from "./tier1";

export interface LoadedModule {
  id: string;
  topicId: string;
  topicTitle: string;
  courseName: string;
  major?: string;
  contentMarkdown: string;
  /** Citation order, as stored on the module. */
  paperIds: string[];
  /** Approved papers only, keyed by id (title + text for matching). */
  sources: Tier1Source[];
  verifyReport: string | null;
  criticReport: string | null;
  repairAttempts: number;
}

/** Returns null when the module does not exist (routes answer 404). */
export async function loadModuleForVerification(moduleId: string): Promise<LoadedModule | null> {
  const mod = await prisma.module.findUnique({
    where: { id: moduleId },
    include: { topic: { include: { course: true } } },
  });
  if (!mod) return null;

  let paperIds: string[] = [];
  try {
    paperIds = JSON.parse(mod.sourcePaperIds || "[]") as string[];
  } catch {
    // A corrupt id list means NO citation can be resolved; Tier 1 then reports
    // every `[n]` as phantom, which is the honest outcome (never "fine").
    paperIds = [];
  }

  const approved = await prisma.topicPaper.findMany({
    where: { topicId: mod.topicId, approved: true },
    include: { paper: true },
  });
  const approvedById = new Map(approved.map((tp) => [tp.paperId, tp.paper]));
  const sources: Tier1Source[] = [];
  for (const id of paperIds) {
    const paper = approvedById.get(id);
    if (!paper) continue; // not approved (or gone) → its citations are phantoms
    sources.push({ id: paper.id, title: paper.title, text: paper.abstract ?? "" });
  }

  return {
    id: mod.id,
    topicId: mod.topicId,
    topicTitle: mod.topic.title,
    courseName: mod.topic.course?.name ?? "mata kuliah ini",
    major: mod.topic.course?.major ?? undefined,
    contentMarkdown: mod.contentMarkdown,
    paperIds,
    sources,
    verifyReport: mod.verifyReport,
    criticReport: mod.criticReport,
    repairAttempts: mod.repairAttempts ?? 0,
  };
}
