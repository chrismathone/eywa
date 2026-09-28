import { NextResponse } from "next/server";
import { isValidYmd, kstToday } from "@/lib/date-kst";
import { parseProgram } from "@/features/students/program";
import { restrictIdsFor } from "@/features/students/server/restrict-ids";
import { parseLevels, parseMixes } from "@/features/students/list-filter-values";
import { requireAccess } from "@/lib/auth/require-access";
import { attachmentFilename } from "@/lib/http/content-disposition";
import {
  getStudentsList,
  type StudentSort,
  type SearchField,
} from "@/features/students/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { buildStudentsWorkbook } from "@/features/exports/students-excel";
import { effectiveTeacherScope } from "@/lib/auth/view-mode";
import { subjectAxisOf, coerceSubjectFilter } from "@/features/students/scope-axis";

export async function GET(request: Request) {
  await requireAccess("students");

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  // 🔴 강사 스코프면 파일도 **화면과 같은 축**이어야 한다 — 안 그러면 "화면엔 없는 영어가 파일엔 있다".
  //    과목 필터가 축 밖이면 화면(page.tsx)과 같은 규칙으로 "전체"로 되돌린다.
  const axis = subjectAxisOf(await effectiveTeacherScope());
  const subject = coerceSubjectFilter(axis, url.searchParams.get("subject") ?? undefined);
  const q = url.searchParams.get("q") ?? undefined;
  // 고급 필터 — 화면 필터와 동일하게 export에 반영(목록과 파일 불일치 방지). 과목·학년·담임은 쉼표 다중 값 그대로 넘긴다
  // (getStudentsList가 화면과 같은 parseMulti로 푼다 — 원장 2026-09-28 다중 선택).
  const grade = url.searchParams.get("grade") ?? undefined;
  const teacherId = url.searchParams.get("teacher") ?? undefined;
  const sortParam = url.searchParams.get("sort");
  const sort: StudentSort | undefined =
    sortParam === "name" || sortParam === "recent" ? sortParam : undefined;
  const fieldParam = url.searchParams.get("field");
  const searchField = (fieldParam ?? undefined) as SearchField | undefined;
  const excludeNoEnrollment = url.searchParams.get("noenr") === "1";
  // 운영실 KPI ↗ 집합(program=·first=) — 목록과 **같은 함수**로 좁혀 파일 행 = 목록 행. 없는 날짜는 필터 없음.
  const firstParam = url.searchParams.get("first");
  const restrictPromise = restrictIdsFor(
    parseProgram(url.searchParams.get("program")),
    isValidYmd(firstParam) ? firstParam : null,
    // 운영실 '재원생 구성' 막대 조각 — 화면과 같은 compositionStudentIds(파일 행 = 목록 행).
    { levels: parseLevels(url.searchParams.get("level")), mixes: parseMixes(url.searchParams.get("mix")) },
  );

  const [rows, settings, restrict] = await Promise.all([
    getStudentsList(
      {
        status,
        subject,
        q,
        grade,
        teacherId,
        sort,
        searchField,
        excludeNoEnrollment,
      },
      // 🔴 화면(/students)은 강사 스코프로 좁혀 보여주는데 이 라우트는 스코프를 아예 안 봤다 —
      //    강사가 '엑셀 내보내기'를 누르면 **학원 전체 학생 + 학부모 연락처**가 파일로 떨어졌다
      //    (2026-08-18 "강사 = 담당 학생만 열람" 결정의 남은 뒷문, #77). 목록과 같은 스코프로 맞춘다.
      { applyTeacherScope: true },
    ),
    getTenantSettings(),
    restrictPromise,
  ]);
  const students = restrict ? rows.filter((row) => restrict.has(row.id)) : rows;
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const wb = await buildStudentsWorkbook(students, subjects.labelOf);
  const buf = await wb.xlsx.writeBuffer();
  // 파일명 날짜는 **KST 오늘** — UTC로 뽑으면 한국 새벽(00~09시)에 어제 날짜가 박힌다.
  const date = kstToday();
  return new NextResponse(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachmentFilename(`원생목록_${date}.xlsx`),
    },
  });
}
