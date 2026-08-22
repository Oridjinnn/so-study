import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireUser, notFoundForUser } from "@/src/lib/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Delete a Topic that has no Module yet (the "BARU" rows in the course list).
//
// A module-backed topic is deleted through `DELETE /api/modules/[id]`, whose
// confirmation dialog states that the whole study trail goes with it; a
// topic-only row had no delete path at all and could only be abandoned. The
// Topic cascade in prisma/schema.prisma removes its TopicPapers, Q&A sessions,
// attempts and question-bank items; the shared Paper rows are left alone
// because other topics may cite them.
//
// Contract: DELETE -> 200 { ok: true } | 404 { error } | 409 { error } when the
// topic still owns a module (fail fast with a clear message, rule I8).
//
// Tenancy: the topic is read with `findFirst({ where: { id, ownerId } })`, so a
// topic that does not exist OR belongs to another student resolves to the SAME
// 404. We never confirm that a guessed id is real (a 403 would), and we never
// touch a row that is not the caller's.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const { id } = await params;
  const topic = await prisma.topic.findFirst({
    where: { id, ownerId },
    include: { module: true },
  });
  // 404, not 403: a topic that is someone else's is indistinguishable from one
  // that was never there.
  if (!topic) return notFoundForUser("Topik");

  if (topic.module) {
    return NextResponse.json(
      { error: "Topik ini sudah punya modul — hapus lewat tombol 'Hapus modul'." },
      { status: 409 },
    );
  }
  await prisma.topic.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
