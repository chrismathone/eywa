import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getStudentsList,
  type StudentSort,
  type SearchField,
} from "@/features/students/server/queries";
import { buildStudentsWorkbook } from "@/features/exports/students-excel";

export async function GET(request: Request) {
  await requireAccess("students");

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const subject = url.searchParams.get("subject") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  // 고급 필터 — 화면 필터와 동일하게 export에 반영(목록과 파일 불일치 방지).
  const grade = url.searchParams.get("grade") ?? undefined;
  const teacherId = url.searchParams.get("teacher") ?? undefined;
  const sortParam = url.searchParams.get("sort");
  const sort: StudentSort | undefined =
    sortParam === "name" || sortParam === "recent" ? sortParam : undefined;
  const fieldParam = url.searchParams.get("field");
  const searchField = (fieldParam ?? undefined) as SearchField | undefined;
  const excludeNoEnrollment = url.searchParams.get("noenr") === "1";

  const students = await getStudentsList({
    status,
    subject,
    q,
    grade,
    teacherId,
    sort,
    searchField,
    excludeNoEnrollment,
  });
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
