import "server-only";
import type ExcelJS from "exceljs";
import type { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { EDIT_HEADERS, EDIT_SHEET_NAME } from "@/features/timetable/import/parse";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

type EditEnr = {
  id: string;
  class?: { class_name?: string } | { class_name?: string }[];
  student?: { name?: string; school?: string | null; grade?: string | null } | { name?: string }[];
};

/**
 * '수강편집' 시트를 워크북에 추가 — 라운드트립 import용(enrollmentId 앵커, 운영자가 '반' 열만 편집).
 * 일반 시간표 export(timetable-excel)와 수학·영어 export(*-timetable/build-buffer)가 공유하는 단일 소스.
 * 활성 수강(end_date IS NULL)만, 반→학생 정렬. 전건 페이지네이션으로 1000행 silent 절단 회피(B2).
 * 이 시트가 있어야 import(parseEditSheet)가 동작 → 수학·영어·구글시트 export도 라운드트립이 닫힌다.
 *
 * ⚠️ `subject` 지정 시 그 과목 반의 수강만 담는다(과목별 시트 분리 = 영어 파일엔 영어 학생만).
 *    미지정(제네릭 export)이면 전 과목. inner join(`class!inner`)으로 subject 필터가 실제 걸린다.
 */
export async function appendEnrollmentEditSheet(
  wb: ExcelJS.Workbook,
  supabase: ServerClient,
  subject?: string,
): Promise<void> {
  const enrRows = await fetchAllPaged<EditEnr>((from, to) => {
    const q = subject
      ? supabase
          .from("enrollments")
          .select("id, class:class_id!inner ( class_name, subject ), student:student_id ( name, school, grade )")
          .eq("class.subject", subject)
      : supabase
          .from("enrollments")
          .select("id, class:class_id ( class_name ), student:student_id ( name, school, grade )");
    return q.is("end_date", null).range(from, to);
  });
  const edit = wb.addWorksheet(EDIT_SHEET_NAME);
  edit.columns = [
    { header: EDIT_HEADERS[0], key: "className", width: 18 }, // 반 (편집 가능)
    { header: EDIT_HEADERS[1], key: "name", width: 12 }, // 학생
    { header: EDIT_HEADERS[2], key: "school", width: 14 }, // 학교
    { header: EDIT_HEADERS[3], key: "grade", width: 8 }, // 학년
    { header: EDIT_HEADERS[4], key: "enrollmentId", width: 38 }, // 수정 금지
  ];
  edit.getRow(1).font = { bold: true };
  const editData = enrRows
    .map((e) => {
      const cls = (Array.isArray(e.class) ? e.class[0] : e.class) as { class_name?: string } | undefined;
      const stu = (Array.isArray(e.student) ? e.student[0] : e.student) as
        | { name?: string; school?: string | null; grade?: string | null }
        | undefined;
      return {
        className: cls?.class_name ?? "",
        name: stu?.name ?? "",
        school: stu?.school ?? "",
        grade: stu?.grade ?? "",
        enrollmentId: e.id,
      };
    })
    .sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name));
  for (const row of editData) edit.addRow(row);
}
