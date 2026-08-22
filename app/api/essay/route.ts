import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { generateEssayPromptWithFallback } from "@/src/lib/essay";
import { assertBudget } from "@/src/lib/aiusage";
import { GUARD_STATUS, guardBodyBytes } from "@/src/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retry endpoint for the essay question (Bug 1 fix #3): when synthesis leaves
// `essayPrompt = null` (generation failed after retry), the UI offers a retry
// that regenerates ONLY the question — no module re-synthesis, no rubric (the
// rubric is harness-built and unchanged).
export async function POST(req: NextRequest) {
  const tooBig = guardBodyBytes(req.headers.get("content-length"));
  if (tooBig) {
    return NextResponse.json({ error: tooBig.error }, { status: GUARD_STATUS });
  }

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

  const mod = await prisma.module.findUnique({
    where: { id: moduleId },
    include: { topic: true },
  });
  if (!mod) {
    return NextResponse.json({ error: "Modul tidak ditemukan." }, { status: 404 });
  }

  // Cost gate (workstream C): generateEssayPromptWithFallback() may spend a
  // Gemini call, so the gate runs before it. The module lookup above is a cheap
  // read; the gate sits in front of the only paid work.
  try {
    await assertBudget();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 429 });
  }

  try {
    const essayPrompt = await generateEssayPromptWithFallback(
      mod.contentMarkdown ?? "",
      body.topicId,
      mod.topic?.title,
    );
    await prisma.module.update({ where: { id: moduleId }, data: { essayPrompt } });
    return NextResponse.json({ essayPrompt });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
