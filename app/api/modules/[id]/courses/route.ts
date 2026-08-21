import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Link an existing module to a course (matakuliah). A module can belong to many
// courses, so this is an additive, idempotent link — never removes others.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { courseId?: string; courseName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const mod = await prisma.module.findUnique({ where: { id } });
  if (!mod) {
    return NextResponse.json({ error: "Modul tidak ditemukan." }, { status: 404 });
  }

  let courseId = body.courseId?.trim();
  if (!courseId && body.courseName?.trim()) {
    const course = await prisma.course.upsert({
      where: { name: body.courseName.trim() },
      update: {},
      create: { name: body.courseName.trim() },
    });
    courseId = course.id;
  }
  if (!courseId) {
    return NextResponse.json(
      { error: "Sediakan courseId atau courseName." },
      { status: 400 },
    );
  }

  await prisma.courseModule.upsert({
    where: { courseId_moduleId: { courseId, moduleId: id } },
    update: {},
    create: { courseId, moduleId: id },
  });

  const links = await prisma.courseModule.findMany({
    where: { moduleId: id },
    include: { course: true },
  });
  return NextResponse.json({
    courses: links.map((l) => ({ id: l.course.id, name: l.course.name })),
  });
}

// Unlink a module from one course (matakuliah). This is how the user "changes"
// a module's matakuliah: remove it from the wrong course, then add it to the
// right one via POST. Never deletes the module or other course links.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { courseId?: string; courseName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const mod = await prisma.module.findUnique({ where: { id } });
  if (!mod) {
    return NextResponse.json({ error: "Modul tidak ditemukan." }, { status: 404 });
  }

  let courseId = body.courseId?.trim();
  if (!courseId && body.courseName?.trim()) {
    const course = await prisma.course.findUnique({ where: { name: body.courseName.trim() } });
    if (course) courseId = course.id;
  }
  if (!courseId) {
    return NextResponse.json(
      { error: "Sediakan courseId atau courseName." },
      { status: 400 },
    );
  }

  await prisma.courseModule.deleteMany({ where: { moduleId: id, courseId } });

  const links = await prisma.courseModule.findMany({
    where: { moduleId: id },
    include: { course: true },
  });
  return NextResponse.json({
    courses: links.map((l) => ({ id: l.course.id, name: l.course.name })),
  });
}
