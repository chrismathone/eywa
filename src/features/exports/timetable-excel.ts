import "server-only";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { EDIT_HEADERS, EDIT_SHEET_NAME } from "@/features/timetable/import/parse";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import type { PillColor } from "@/components/atoms/pill";

const DAY_LABEL: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// PillColor(과목 색, 학원설정 단일 소스) → 엑셀 셀 argb 소프트 톤. 과목별 하드코딩 맵 금지 —
// 색은 buildSubjectMaps(operations.subjects).colorOf로 결정하고 여기선 PillColor→hex만 변환.
const PILL_HEX: Record<PillColor, string> = {
  primary: "FFCDE9D9",
  blue: "FFD2E4F2",
  rose: "FFF4D7DE",
  purple: "FFE4D9F1",
  amber: "FFF5E3C6",
  gold: "FFF1E4C9",
  danger: "FFF6D6D6",
  neutral: "FFEDE9DC",
};

/**
 * 시간표를 exceljs workbook으로 변환.
 * - 시트 1: "전체" — 요일 × 강사 매트릭스
 * - 시트 N: 강사별 — 요일 × 교시 매트릭스
 * - _meta: 셀 좌표 ↔ class/enrollment id 매핑 (라운드트립 import 대비)
 */
export async function buildTimetableWorkbook(): Promise<ExcelJS.Workbook> {
  const supabase = await createClient();
  // 과목 셀 색은 학원설정(operations.subjects) 단일 소스 — colorOf(PillColor) → PILL_HEX.
  const settings = await getTenantSettings();
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const subjectHex = (subject: string) => PILL_HEX[subjectMaps.colorOf(subject)];

  // 데이터 수집: schedule + class + 학생. 폐지(is_active=false)된 반은 제외(시간표 화면과 일관) — `!inner` + 필터.
  const { data: schedules } = await supabase
    .from("class_schedules")
    .select(
      `id, class_id, day_of_week, start_time, end_time,
       class:class_id!inner ( id, class_name, subject, is_active, teacher_id, classroom:classroom_id ( name ),
                        teacher:teacher_id ( id, display_name ) )`,
    )
    .eq("class.is_active", true)
    .order("start_time");

  const slots = (schedules ?? []).map((s) => {
    const cls = (Array.isArray(s.class) ? s.class[0] : s.class) as
      | {
          id: string;
          class_name: string;
          subject: string;
          teacher_id?: string | null;
          teacher?: { id?: string; display_name?: string } | { id?: string; display_name?: string }[];
          classroom?: { name?: string } | { name?: string }[];
        }
      | undefined;
    const teacher = (Array.isArray(cls?.teacher) ? cls?.teacher[0] : cls?.teacher) as
      | { id?: string; display_name?: string }
      | undefined;
    const room = (Array.isArray(cls?.classroom) ? cls?.classroom[0] : cls?.classroom) as
      | { name?: string }
      | undefined;
    return {
      scheduleId: s.id,
      classId: cls?.id ?? "",
      className: cls?.class_name ?? "?",
      subject: cls?.subject ?? "etc",
      teacherId: teacher?.id ?? null,
      teacherName: teacher?.display_name ?? null,
      classroomName: room?.name ?? null,
      dayOfWeek: s.day_of_week,
      startTime: String(s.start_time).slice(0, 5),
      endTime: String(s.end_time).slice(0, 5),
    };
  });

  // 학생 명단
  const classIds = Array.from(new Set(slots.map((s) => s.classId)));
  let studentsByClass = new Map<
    string,
    { name: string; grade: string | null }[]
  >();
  if (classIds.length > 0) {
    // 전체 반×학생이 1000행 초과 시 단일 .in()이 silent 절단(엑셀에 명단 누락) → fetchInChunks(반
    // 50개씩, 청크당 행<1000)로 414·절단 방어. 메인 시간표 쿼리와 동일 헬퍼.
    const enr = await fetchInChunks<{ class_id: string; student: unknown }>(
      classIds,
      (chunk) =>
        supabase
          .from("enrollments")
          .select(`class_id, student:student_id ( name, grade )`)
          .in("class_id", chunk)
          .is("end_date", null),
      50,
    );
    studentsByClass = new Map();
    for (const e of enr) {
      const s = (Array.isArray(e.student) ? e.student[0] : e.student) as
        | { name?: string; grade?: string | null }
        | undefined;
      if (!s?.name) continue;
      const list = studentsByClass.get(e.class_id) ?? [];
      list.push({ name: s.name, grade: s.grade ?? null });
      studentsByClass.set(e.class_id, list);
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "eywa";
  wb.created = new Date();

  // ─── 시트 1: 전체 (요일 × 시간대) ───
  const overall = wb.addWorksheet("전체", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });

  // 교시 추출
  const periods = Array.from(new Set(slots.map((s) => s.startTime))).sort();

  overall.columns = [
    { header: "교시", key: "period", width: 10 },
    ...DAY_ORDER.map((d) => ({
      header: `${DAY_LABEL[d]}요일`,
      key: d,
      width: 32,
    })),
  ];
  overall.getRow(1).font = { bold: true };

  for (const period of periods) {
    const row: Record<string, string> = { period };
    for (const day of DAY_ORDER) {
      const cellSlots = slots.filter((s) => s.dayOfWeek === day && s.startTime === period);
      row[day] = cellSlots
        .map((s) => {
          const stus = studentsByClass.get(s.classId) ?? [];
          const studentList = stus.map((st) => st.name).join(", ");
          return `[${s.className}] ${s.startTime}~${s.endTime}\n${s.teacherName ?? "—"} · ${s.classroomName ?? "—"}\n${studentList} (${stus.length}명)`;
        })
        .join("\n\n");
    }
    const r = overall.addRow(row);

    // 셀 색상 (첫번째 슬롯의 과목 기준)
    for (let i = 0; i < DAY_ORDER.length; i++) {
      const day = DAY_ORDER[i];
      const cellSlots = slots.filter((s) => s.dayOfWeek === day && s.startTime === period);
      if (cellSlots.length === 0) continue;
      const color = subjectHex(cellSlots[0].subject);
      const cell = r.getCell(i + 2);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: color },
      };
      cell.alignment = { vertical: "top", wrapText: true };
    }
  }

  // ─── 강사별 시트 ───
  const teachers = Array.from(
    new Map(slots.filter((s) => s.teacherName).map((s) => [s.teacherId, s.teacherName])).entries(),
  );
  for (const [teacherId, teacherName] of teachers) {
    if (!teacherName) continue;
    const sheet = wb.addWorksheet(teacherName, {
      views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
    });
    sheet.columns = [
      { header: "교시", key: "period", width: 10 },
      ...DAY_ORDER.map((d) => ({ header: `${DAY_LABEL[d]}요일`, key: d, width: 32 })),
    ];
    sheet.getRow(1).font = { bold: true };

    const teacherSlots = slots.filter((s) => s.teacherId === teacherId);
    const teacherPeriods = Array.from(new Set(teacherSlots.map((s) => s.startTime))).sort();

    for (const period of teacherPeriods) {
      const row: Record<string, string> = { period };
      for (const day of DAY_ORDER) {
        const ts = teacherSlots.filter((s) => s.dayOfWeek === day && s.startTime === period);
        row[day] = ts
          .map((s) => {
            const stus = studentsByClass.get(s.classId) ?? [];
            return `[${s.className}] ${s.startTime}~${s.endTime}\n${stus.map((st) => st.name).join(", ")}`;
          })
          .join("\n\n");
      }
      const r = sheet.addRow(row);
      for (let i = 0; i < DAY_ORDER.length; i++) {
        const day = DAY_ORDER[i];
        const ts = teacherSlots.filter((s) => s.dayOfWeek === day && s.startTime === period);
        if (ts.length === 0) continue;
        const color = subjectHex(ts[0].subject);
        const cell = r.getCell(i + 2);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: color },
        };
        cell.alignment = { vertical: "top", wrapText: true };
      }
    }
  }

  // ─── _meta 시트 (round-trip용) ───
  const meta = wb.addWorksheet("_meta");
  meta.columns = [
    { header: "scheduleId", width: 38 },
    { header: "classId", width: 38 },
    { header: "className", width: 22 },
    { header: "subject", width: 12 },
    { header: "teacherId", width: 38 },
    { header: "dayOfWeek", width: 8 },
    { header: "startTime", width: 10 },
    { header: "endTime", width: 10 },
  ];
  for (const s of slots) {
    meta.addRow([
      s.scheduleId,
      s.classId,
      s.className,
      s.subject,
      s.teacherId ?? "",
      s.dayOfWeek,
      s.startTime,
      s.endTime,
    ]);
  }
  meta.state = "hidden";

  // ─── 수강편집 시트 (라운드트립 import용 — enrollmentId 앵커, 운영자가 '반' 열만 편집) ───
  type EditEnr = {
    id: string;
    class?: { class_name?: string } | { class_name?: string }[];
    student?: { name?: string; school?: string | null; grade?: string | null } | { name?: string }[];
  };
  const enrRows = await fetchAllPaged<EditEnr>((from, to) =>
    supabase
      .from("enrollments")
      .select("id, class:class_id ( class_name ), student:student_id ( name, school, grade )")
      .is("end_date", null)
      .range(from, to),
  );
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

  return wb;
}
