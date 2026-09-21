/**
 * aywa Supabase 데이터 → ijw 수학 익스포터 입력 계약 어댑터.
 *
 * `getWeeklyScheduleWithStudents()` 결과(ScheduleSlotWithStudents[])를 ijw `exportMathTimetableToExcel`이
 * 기대하는 `ExportTimetableParams` 모양으로 변환한다. 익스포터는 verbatim 이식이라 출력이 ijw와 동일하려면
 * 입력 포맷이 정확해야 한다 — 요일(mon→월)·시각(start_time→periodId 1-1..4-2)·slotTeachers 키("월-3")·
 * 학생 등원요일(Korean)·신입 enrollmentDate 매핑이 핵심. 순수함수(단위테스트).
 */
import type { ScheduleSlotWithStudents, StudentLine } from "@/features/timetable/server/queries";
import { weekdayTableFor, type PeriodsConfig, type PeriodTime } from "@/features/timetable/lib/periods";
import { LEGACY_TO_UNIFIED_PERIOD_MAP } from "./constants";
import { buildStudentMemoText, type ExportTimetableParams } from "./exporter";
import type { TimetableClass, TimetableStudent, Teacher } from "./types";

const DOW_KO: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};
const WEEK_ORDER_KO = ["월", "화", "수", "목", "금", "토", "일"];

// 평일 수학 시각(start) → periodId. ijw MATH_PERIOD_TIMES 시작 시각 기준.
const WEEKDAY_START_TO_PERIOD: Record<string, string> = {
  "14:30": "1-1",
  "15:25": "1-2",
  "16:20": "2-1",
  "17:15": "2-2",
  "18:20": "3-1",
  "19:15": "3-2",
  "20:10": "4-1",
  "21:05": "4-2",
};
// 주말 시각(start) → periodId. ijw WEEKEND_PERIOD_TIMES 시작 시각 기준.
const WEEKEND_START_TO_PERIOD: Record<string, string> = {
  "09:00": "1-1",
  "10:00": "1-2",
  "11:00": "2-1",
  "12:00": "2-2",
  "13:00": "3-1",
  "14:00": "3-2",
  "15:00": "4-1",
  "16:00": "4-2",
};

const hm = (t: string): string => (t ?? "").slice(0, 5);
const isWeekend = (dow: string): boolean => dow === "sat" || dow === "sun";

// 익스포터 그리드는 레거시 8교시(1-1..4-2) 고정 — 설정 교시를 숫자 id 정렬 앞 8개→레거시 id로 사상.
const LEGACY_PERIOD_IDS = ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2", "4-1", "4-2"];

/**
 * 설정 교시표 → start(HH:MM)→레거시 periodId 역인덱스. 테넌트가 교시 시각을 커스터마이징하면
 * (과목 운영 탭 수학 전용 교시·전역 평일/주말 교시) 하드코딩 상수 대신 이걸로 매핑해야 슬롯이
 * 엑셀/시트에서 무에러 증발하지 않는다(병합 적대리뷰 2026-07-06). 기본 설정에서의 산출은
 * WEEKDAY/WEEKEND_START_TO_PERIOD 상수와 동일(회귀 0 — 단위테스트 고정).
 * 한계: 8교시 초과 커스텀 교시는 레거시 그리드에 못 올림(초과분은 매핑 없음 → skip 카운트로 노출).
 */
function startToPeriodMap(table: Record<string, PeriodTime>): Record<string, string> {
  const ids = Object.keys(table)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .slice(0, LEGACY_PERIOD_IDS.length);
  const out: Record<string, string> = {};
  ids.forEach((id, i) => {
    const start = hm(table[String(id)]?.startTime ?? "");
    if (start) out[start] = LEGACY_PERIOD_IDS[i];
  });
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export type AssembleOpts = {
  /** 대상 주차 월요일(이 날짜가 속한 주). weekDates·referenceDate 기준. */
  referenceMonday: Date;
  /** 강사명 → 색(직원관리 강사색). 없으면 익스포터 기본색. */
  teacherColors?: Record<string, { bgColor?: string | null; textColor?: string | null }>;
  /** 헤더 라벨. 미지정 시 referenceMonday로 도출. */
  weekLabel?: string;
  /** 과목 표시명(헤더). 기본 "수학". */
  subjectLabel?: string;
  /** 테넌트 교시 설정(과목별 override 포함) — 미지정 시 기본 상수 맵(기본 설정과 동일 산출). */
  periodsConfig?: PeriodsConfig;
  /** 교시 매핑 실패로 그리드에서 제외된 슬롯 수 알림(무에러 증발 방지 — 호출부가 로깅). */
  onSkippedSlots?: (count: number) => void;
};

/** aywa StudentLine → 익스포터 studentList 항목(상태/날짜/등원요일 전부 포함, any로 소비됨). */
function toStudent(s: StudentLine): TimetableStudent {
  return {
    id: s.studentId,
    name: s.name,
    school: s.school,
    grade: s.grade,
    // 등원요일 Korean 변환(["mon","thu"]→["월","목"]). 비면 전 요일.
    attendanceDays: (s.attendanceDays ?? []).map((d) => DOW_KO[d] ?? d).filter(Boolean),
    onHold: s.status === "hold",
    withdrawalDate: s.status === "withdrawn" ? (s.endDate ?? undefined) : undefined,
    // aywa 퇴원 목록은 이미 is_transferred 제외(queries.ts) → 항상 false(퇴원 섹션에 표시되도록).
    isTransferred: false,
    isTransferredIn: s.isTransferredIn === true,
    // 30/60일 신입색·정렬 가중치. 재원/대기만 enrollmentDate 보유(퇴원은 무관).
    enrollmentDate: s.enrollmentDate ?? undefined,
    firstSubjectEnrollmentDate: s.enrollmentDate ?? undefined,
  };
}

/**
 * 수학 슬롯 집합 → ExportTimetableParams. 입력 slots는 전 과목; 여기서 math만 필터.
 */
export function assembleMathParams(
  allSlots: ScheduleSlotWithStudents[],
  opts: AssembleOpts,
): ExportTimetableParams {
  const slots = allSlots.filter((s) => s.subject === "math");

  // 시각→periodId 맵: 설정(config) 파생 우선, 미전달 시 기본 상수(동일 산출 — 회귀 0).
  const weekdayMap = opts.periodsConfig
    ? startToPeriodMap(weekdayTableFor("math", opts.periodsConfig))
    : WEEKDAY_START_TO_PERIOD;
  const weekendMap = opts.periodsConfig
    ? startToPeriodMap(opts.periodsConfig.weekend)
    : WEEKEND_START_TO_PERIOD;
  const slotPeriodIdOf = (dow: string, startTime: string): string | null =>
    (isWeekend(dow) ? weekendMap : weekdayMap)[hm(startTime)] ?? null;
  let skippedSlots = 0;

  // 반(classId)별 묶기
  const byClass = new Map<string, ScheduleSlotWithStudents[]>();
  for (const s of slots) {
    const list = byClass.get(s.classId) ?? [];
    list.push(s);
    byClass.set(s.classId, list);
  }

  const presentPeriods = new Set<string>();
  const presentDaysKo = new Set<string>();
  const resourceNames = new Set<string>();

  const filteredClasses: TimetableClass[] = [];
  for (const [classId, cslots] of byClass) {
    const first = cslots[0];
    const schedule: string[] = [];
    const slotTeachers: Record<string, string> = {};
    const slotRooms: Record<string, string> = {};

    for (const s of cslots) {
      const dayKo = DOW_KO[s.dayOfWeek];
      const periodId = slotPeriodIdOf(s.dayOfWeek, s.startTime);
      if (!dayKo || !periodId) {
        skippedSlots += 1; // 매핑 불가 슬롯은 그리드에 못 올림 — 조용히 버리지 않고 카운트해 알림
        continue;
      }
      presentPeriods.add(periodId);
      presentDaysKo.add(dayKo);
      schedule.push(`${dayKo} ${periodId}`);
      const unified = LEGACY_TO_UNIFIED_PERIOD_MAP[periodId] ?? periodId;
      const slotKey = `${dayKo}-${unified}`;
      if (s.slotTeacherLabel) slotTeachers[slotKey] = s.slotTeacherLabel;
      if (s.slotRoomLabel) slotRooms[slotKey] = s.slotRoomLabel;
      // 컬럼 리소스 = 셀 강사라벨 우선, 없으면 반 담임.
      const eff = (s.slotTeacherLabel || s.teacherName || "").trim();
      if (eff) resourceNames.add(eff);
    }
    if (schedule.length === 0) continue;

    // 학생: 반 모든 슬롯이 같은 명단(byClass) — 첫 슬롯 기준.
    const studentList: TimetableStudent[] = (first.students ?? []).map(toStudent);

    filteredClasses.push({
      id: classId,
      className: first.className,
      teacher: (first.teacherName ?? "").trim(),
      room: first.classroomName ?? undefined,
      subject: opts.subjectLabel ?? "수학",
      schedule,
      studentList,
      slotTeachers,
      slotRooms,
      bgColor: first.classBgColor ?? undefined,
      textColor: first.classTextColor ?? undefined,
    });
  }

  // 강사 리스트(색 조회용)
  const teachers: Teacher[] = [...resourceNames].sort((a, b) => a.localeCompare(b, "ko")).map((name) => {
    const c = opts.teacherColors?.[name];
    return { id: name, name, bgColor: c?.bgColor ?? undefined, textColor: c?.textColor ?? undefined };
  });
  const allResources = teachers.map((t) => t.name);

  // 요일·날짜
  const mon = opts.referenceMonday;
  const weekDates: Record<string, { date: Date; formatted: string }> = {};
  WEEK_ORDER_KO.forEach((dayKo, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    weekDates[dayKo] = { date: d, formatted: `${d.getMonth() + 1}/${d.getDate()}` };
  });
  const orderedSelectedDays = WEEK_ORDER_KO.filter((d) => presentDaysKo.has(d));

  // currentPeriods = 데이터에 실제 등장한 periodId(정렬). 없으면 표준 평일셋 폴백.
  const STANDARD = ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2", "4-1", "4-2"];
  const currentPeriods = STANDARD.filter((p) => presentPeriods.has(p));

  const weekLabel =
    opts.weekLabel ?? `${mon.getFullYear()}년 ${mon.getMonth() + 1}월 ${mon.getDate()}일 주`;

  // 학생 hover 메모(진도+교재) — 이름 → 텍스트. ijw studentMemoMap 패리티.
  const memoStudents = new Map<string, StudentLine>();
  for (const s of slots) {
    for (const st of s.students ?? []) {
      if (!memoStudents.has(st.studentId)) memoStudents.set(st.studentId, st);
    }
  }
  if (skippedSlots > 0) opts.onSkippedSlots?.(skippedSlots);

  const studentMemoMap: Record<string, string> = {};
  for (const st of memoStudents.values()) {
    const text = buildStudentMemoText(
      st.latestTextbook ? { textbookName: st.latestTextbook.name } : null,
      st.latestReport ? { progress: st.latestReport.progress ?? undefined, date: st.latestReport.date } : null,
    );
    if (text) studentMemoMap[st.name] = text;
  }

  return {
    weekLabel,
    filteredClasses,
    allResources,
    orderedSelectedDays: orderedSelectedDays.length ? orderedSelectedDays : ["월", "화", "수", "목", "금"],
    weekDates,
    teachers,
    currentPeriods: currentPeriods.length ? currentPeriods : STANDARD,
    studentMap: {}, // 익스포터 미사용(로컬 studentMap 사용) — 빈 객체.
    subjectFilter: opts.subjectLabel ?? "수학",
    showHoldStudents: true,
    showWithdrawnStudents: true,
    referenceDate: ymd(mon),
    studentMemoMap,
  };
}
