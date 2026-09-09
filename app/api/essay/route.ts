import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { notFoundForUser, requireUser } from "@/src/lib/tenancy";
import { generateEssayPromptWithFallback } from "@/src/lib/essay";
import { assertBudget } from "@/src/lib/aiusage";
import { GUARD_STATUS, guardBodyBytes } from "@/src/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retry endpoint for the essay question (Bug 1 fix #3): when synthesis leaves
// `essayPrompt = null` (generation failed after retry), the UI offers a retry
// that regenerates ONLY the question — no module re-synthesis, no rubric (the
// rubric is harness-built and unchanged).
//
// Gate order: session → free body-size guard → the module resolved WITHIN the
// caller's rows → AI budget → the paid call. The session comes first so an
// anonymous request costs neither a DB read nor a look at budget state; the
// budget stays immediately in front of the only paid work, exactly where
// workstream C put it.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const tooBig = guardBodyBytes(req.headers.get("content-length"));
  if (tooBig) {
    return NextResponse.json({ error: tooBig.error }, { status: GUARD_STATUS });
  }

  // `topicId` is still accepted (and still sent by the client) so the request
  // shape does not change, but it is no longer READ: see the call below.
  let body: { moduleId?: string; topicId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const moduleId = body.moduleId?.trim();
  if (!moduleId) {
    return NextResponse.json({ error: "Field 'moduleId' is required." }, { status: 400 });
  }

  // `moduleId` arrives in the BODY here rather than the path, which changes
  // nothing: it is caller-supplied either way, so the owner is folded into the
  // lookup (findFirst, never findUnique). A module id belonging to the other
  // student is a 404 and, because this read sits before the budget gate and the
  // Gemini call, it costs no AI spend at all.
  const mod = await prisma.module.findFirst({
    where: { id: moduleId, ownerId },
    include: { topic: true },
  });
  if (!mod) return notFoundForUser("Modul");

  // Cost gate (workstream C): generateEssayPromptWithFallback() may spend a
  // Gemini call, so the gate runs before it. The module lookup above is a cheap
  // read; the gate sits in front of the only paid work.
  try {
    await assertBudget();
  } catch (e) {
    console.error("[essay] budget check failed", e);
    return NextResponse.json(
      { error: "Gagal memeriksa anggaran AI; coba lagi nanti." },
      { status: 429 },
    );
  }

  try {
    const essayPrompt = await generateEssayPromptWithFallback(
      mod.contentMarkdown ?? "",
      mod.topicId,
      mod.topic?.title,
    );
    await prisma.module.update({ where: { id: moduleId, ownerId }, data: { essayPrompt } });
    return NextResponse.json({ essayPrompt });
  } catch (e) {
    console.error("[essay] prompt generation failed", e);
    return NextResponse.json(
      { error: "Gagal menghasilkan pertanyaan esai; coba lagi nanti." },
      { status: 502 },
    );
  }
}
