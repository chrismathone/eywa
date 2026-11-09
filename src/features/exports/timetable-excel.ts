import "server-only";
import { kstToday } from "@/lib/date-kst";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { appendEnrollmentEditSheet } from "@/features/exports/enrollment-edit-sheet";
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
// ⚠️ 이 표는 **화면 알약(pill.tsx SOFT_CLASS)의 엑셀 판본**이다 — globals.css 토큰을 바꾸면 여기도
// 같은 커밋에서 갱신할 것(엑셀은 CSS 변수를 못 읽어 자동 추종하지 않는다. v1 그린 팔레트가 v3 네이비
// 전환 때 그대로 남아 "화면=네이비, xlsx=민트그린"으로 갈렸던 것이 2026-07-20 감사에서 적발).
// 값 = 각 토큰 hex를 흰 배경에 alpha 0.22로 합성(화면 soft는 0.08~0.11이라 엑셀 셀에선 거의 안 보여
// 기존 표가 쓰던 시각 무게 0.19~0.27을 유지).
const PILL_HEX: Record<PillColor, string> = {
  primary: "FFCCD5E1", // #363c41 navy
  green: "FFCFE5DA", // #0e7c46 성공/완료
  blue: "FFD1DEF8", // #2d6be0
  rose: "FFF2D4DF", // #c23a6e
  purple: "FFDFD8F3", // #6c50c8
  amber: "FFEBDBC9", // #a35d0a
  gold: "FFE5DECD", // #8a681c
  danger: "FFF5D5D5", // #d33f3f
  neutral: "FFE9E9EE", // --bg-soft
};

type ClassRef = {
  id: string;
  class_name: string;
  subject: string;
  teacher_id?: string | null;
  closed_at?: string | null;
  teacher?: { id?: string; display_name?: string } | { id?: string; display_name?: string }[];
  classroom?: { name?: string } | { name?: string }[];
};
type ScheduleRow = {
  id: string;
  class_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  class?: ClassRef | ClassRef[];
};

/**
 * 시간표를 exceljs workbook으로 변환(수학·영어 전용 익스포터가 없는 과목의 범용 폴백).
 * - 시트 1: "전체" — 요일 × 강사 매트릭스
 * - 시트 N: 강사별 — 요일 × 교시 매트릭스
 * - _meta: 셀 좌표 ↔ class/enrollment id 매핑 (라운드트립 import 대비)
 *
 * ⚠️ `teacherId`(담당 스코프)는 **반드시** 화면과 같은 기준으로 넘길 것 — 옛 시그니처는 인자가 아예 없어
 * 강사가 이 폴백을 타면(수학·영어가 아닌 과목) 전 강사·전 학생 명단이 그대로 나갔다(2026-07-17 적대 감사).
 * ⚠️ `includeEditSheet`는 라운드트립 '수강편집' 시트(=테넌트 전체 수강 명단) — 가져오기 권한자(full)만.
 */
export async function buildTimetableWorkbook(
  opts: { teacherId?: string; includeEditSheet?: boolean } = {},
): Promise<ExcelJS.Workbook> {
  const { teacherId, includeEditSheet = true } = opts;
  const supabase = await createClient();
  // 과목 셀 색은 학원설정(operations.subjects) 단일 소스 — colorOf(PillColor) → PILL_HEX.
  const settings = await getTenantSettings();
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const subjectHex = (subject: string) => PILL_HEX[subjectMaps.colorOf(subject)];

  // 데이터 수집: schedule + class + 학생. 폐지(is_active=false)·종강(closed_at<오늘) 반은 제외(시간표 화면과 일관).
  // 🔴 **KST 오늘** — 종강 반 판정(`closed_at < 오늘`)에 쓰는 값이라 UTC로 뽑으면 한국 새벽에
  //    하루 어긋나 그날 종강한 반이 엑셀에만 남거나 빠진다(화면은 KST 기준이다).
  const todayIso = kstToday();
  // B2: 무페이징 select는 1000행에서 조용히 잘려 반·교시가 통째로 증발한다 → fetchAllPaged(id tie-break).
  // 강사 스코프는 조인 필터로 DB에서 건다(전건 받아 JS에서 버리지 않음).
  const schedules = await fetchAllPaged<ScheduleRow>((from, to) => {
    let q = supabase
      .from("class_schedules")
      .select(
        `id, class_id, day_of_week, start_time, end_time,
       class:class_id!inner ( id, class_name, subject, is_active, closed_at, teacher_id, classroom:classroom_id ( name ),
                        teacher:teacher_id ( id, display_name ) )`,
      )
      .eq("class.is_active", true);
    if (teacherId) q = q.eq("class.teacher_id", teacherId);
    return q.order("start_time").order("id").range(from, to);
  });

  const slots = schedules
    .filter((s) => {
      const k = (Array.isArray(s.class) ? s.class[0] : s.class) as { closed_at?: string | null } | undefined;
      const closedAt = k?.closed_at ?? null;
      return !closedAt || closedAt >= todayIso; // 종강 반 제외
    })
    .map((s) => {
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
    // ⚠️ fetchInChunks는 414만 막고 청크 **안에서는** 페이지네이션을 안 한다 — 50반이라도 반당 20명이면
    // 1000행을 넘겨 엑셀 명단이 조용히 잘린다(B2) → fetchAllPagedInChunks. 메인 시간표 쿼리와 동일 헬퍼.
    const enr = await fetchAllPagedInChunks<{ class_id: string; student: unknown }>(
      classIds,
      (chunk, from, to) =>
        supabase
          .from("enrollments")
          .select(`class_id, student:student_id ( name, grade )`)
          .in("class_id", chunk)
          .is("end_date", null)
          .order("id")
          .range(from, to),
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
  wb.creator = "에이와";
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
  // 일반·수학 export 공유 단일 소스(enrollment-edit-sheet).
  // ⚠️ 이 시트는 과목 필터 없는 **테넌트 전체 수강 명단**(이름·학교·학년)이라 가져오기 권한자(full)에게만.
  if (includeEditSheet) await appendEnrollmentEditSheet(wb, supabase);

  return wb;
}
