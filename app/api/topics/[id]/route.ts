import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";

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
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const topic = await prisma.topic.findUnique({
    where: { id },
    include: { module: true },
  });
  if (!topic) {
    return NextResponse.json({ error: "Topik tidak ditemukan." }, { status: 404 });
  }
  if (topic.module) {
    return NextResponse.json(
      { error: "Topik ini sudah punya modul — hapus lewat tombol 'Hapus modul'." },
      { status: 409 },
    );
  }
  await prisma.topic.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
