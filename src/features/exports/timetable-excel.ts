import "server-only";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";

const DAY_LABEL: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat"];

const SUBJECT_COLOR: Record<string, string> = {
  math: "FFCDE9D9", // primary soft
  english: "FFD2E4F2", // blue soft
  korean: "FFF4D7DE", // rose soft
  science: "FFE4D9F1", // purple soft
  arts: "FFF5E3C6", // amber soft
  etc: "FFEDE9DC", // bg soft
};

/**
 * 시간표를 exceljs workbook으로 변환.
 * - 시트 1: "전체" — 요일 × 강사 매트릭스
 * - 시트 N: 강사별 — 요일 × 교시 매트릭스
 * - _meta: 셀 좌표 ↔ class/enrollment id 매핑 (라운드트립 import 대비)
 */
export async function buildTimetableWorkbook(): Promise<ExcelJS.Workbook> {
  const supabase = await createClient();

  // 데이터 수집: schedule + class + 학생
  const { data: schedules } = await supabase
    .from("class_schedules")
    .select(
      `id, class_id, day_of_week, start_time, end_time,
       class:class_id ( id, class_name, subject, teacher_id, classroom:classroom_id ( name ),
                        teacher:teacher_id ( id, display_name ) )`,
    )
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
    const { data: enr } = await supabase
      .from("enrollments")
      .select(`class_id, student:student_id ( name, grade )`)
      .in("class_id", classIds)
      .is("end_date", null);
    studentsByClass = new Map();
    for (const e of enr ?? []) {
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
      const color = SUBJECT_COLOR[cellSlots[0].subject] ?? SUBJECT_COLOR.etc;
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
        const color = SUBJECT_COLOR[ts[0].subject] ?? SUBJECT_COLOR.etc;
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

  return wb;
}
