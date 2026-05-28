import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { getStudentsList } from "@/features/students/server/queries";
import { buildStudentsWorkbook } from "@/features/exports/students-excel";

export async function GET(request: Request) {
  await requireAccess("students");

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const subject = url.searchParams.get("subject") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;

  const students = await getStudentsList({ status, subject, q });
  const wb = await buildStudentsWorkbook(students);
  const buf = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="학생목록_${date}.xlsx"`,
    },
  });
}
