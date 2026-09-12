/**
 * **그날 결석 학생** — 출결 칸을 학생 단위로 접는 순수 함수(Vitest).
 * 운영실 '결석학생' 카드·팝업, 출석부 `?status=absent` 목록, 일일 브리핑 '어제 결석' 신호가 전부 이 한 벌을 쓴다.
 * ⚠️ 이 함수는 **날짜를 모른다**(받은 행이 그날의 전부라고 본다) — 어느 날을 세는지는 호출부가 정한다:
 *    운영실 카드는 어제([`absentKpiDate`](./overview/kpi-links.ts), 원장 2026-09-12), 출석부는 URL의 그 날짜.
 *
 * 규칙(원장 2026-09-11 기본값 결정):
 *   · 칸(학생·반·날짜·교시)마다 **최신 정정만** 본다(`effectiveAttendanceRecords`) — 결석을 출석으로 고친 칸은 결석이 아니다.
 *     그래서 조회는 상태로 좁히지 않고 그날 전 칸을 받아야 한다(좁히면 고치기 전 결석 행이 살아난다).
 *   · **결석 학생 = 그날 한 교시도 안 온 학생** — 유효 칸이 전부 결석·공결이고 출석·지각·조퇴·보강 칸이 하나도 없다.
 *   · 일부 교시만 결석하고 다른 교시엔 온 학생은 **세지 않고** '일부 교시 결석'으로 따로 모은다('연락 필요'도 아니다).
 *   · 사전 통보는 **숫자에서 빼지 않는다** — 학생마다 표식으로 가른다. 표식은 AND로 접는다: 그 학생의 결석 중 하나라도
 *     통보가 없으면 연락 대상이다(통보된 건 하나가 무통보 결석을 묻지 않게 — 옛 브리핑 신호의 규약 그대로).
 */
import { effectiveAttendanceRecords, type EffectiveAttendanceRecord } from "@/features/attendance/effective-records";
import { isPreNotified } from "./absence-reasons";

export const ABSENT_STATUSES = ["absent", "excused"] as const;
export type AbsentStatus = (typeof ABSENT_STATUSES)[number];

/** 표시 라벨 — raw 상태 코드 노출 금지. */
export const ABSENT_STATUS_LABEL: Record<AbsentStatus, string> = { absent: "결석", excused: "공결" };

type One<T> = T | T[] | null;

export type AbsentRecordRow = EffectiveAttendanceRecord & {
  status: string;
  /** 결석 사유 — `(데스크 접수)` 표식이 사전 통보 판정에 쓰인다. 원문은 화면·AI로 내보내지 않는다. */
  note?: string | null;
  student: One<{ name?: string | null }>;
  class: One<{ subject?: string | null; class_name?: string | null }>;
};

/** 결석·공결 칸이 있는 반 한 곳. */
export type AbsentClass = { id: string; name: string; subject: string | null };

export type AbsentStudent = {
  studentId: string;
  name: string;
  /** 처음 기록된 결석 칸의 반 과목(과목별 분해용). */
  subject: string | null;
  /** 결석·공결 칸의 반(처음 기록 순, 중복 없음). */
  classes: AbsentClass[];
  /** 그 학생의 결석이 **전부** 사전 통보인가. */
  preNotified: boolean;
  statuses: AbsentStatus[];
};

/** 그날 결석 판정 — 두 무리로 갈라 돌려준다(세는 것은 `absent`뿐). */
export type AbsentDay = {
  /** 한 교시도 안 온 학생 — 카드·브리핑이 세는 '결석 학생'. */
  absent: AbsentStudent[];
  /** 일부 교시만 결석(다른 교시엔 옴) — 세지 않고 '일부 교시 결석'으로만 보인다. */
  partial: AbsentStudent[];
};

function one<T>(value: One<T>): T | undefined {
  return (Array.isArray(value) ? value[0] : value) ?? undefined;
}

function isAbsentStatus(status: string): status is AbsentStatus {
  return (ABSENT_STATUSES as readonly string[]).includes(status);
}

/** 그날 출결 행(전 상태) → 결석 학생 / 일부 교시 결석. 순서는 첫 결석 기록 시각 순. */
export function foldAbsentStudents(rows: readonly AbsentRecordRow[]): AbsentDay {
  const effective = effectiveAttendanceRecords(rows);
  // 한 교시라도 결석·공결이 아닌 칸이 있으면 그날 온 학생이다(출석·지각·조퇴·보강).
  const attended = new Set<string>();
  for (const row of effective) if (!isAbsentStatus(row.status)) attended.add(row.student_id);
  const absences = effective
    .filter((row) => isAbsentStatus(row.status))
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at) || a.id.localeCompare(b.id));
  const byStudent = new Map<string, AbsentStudent>();
  for (const row of absences) {
    const klass = one(row.class);
    const cls: AbsentClass = { id: row.class_id, name: klass?.class_name?.trim() ?? "", subject: klass?.subject ?? null };
    const preNotified = isPreNotified({
      note: row.note ?? null,
      recorded_at: row.recorded_at,
      session_date: row.session_date,
    });
    const status = row.status as AbsentStatus;
    const prev = byStudent.get(row.student_id);
    if (prev) {
      prev.preNotified = prev.preNotified && preNotified;
      if (!prev.statuses.includes(status)) prev.statuses.push(status);
      if (!prev.classes.some((c) => c.id === cls.id)) prev.classes.push(cls);
      continue;
    }
    byStudent.set(row.student_id, {
      studentId: row.student_id,
      name: one(row.student)?.name?.trim() || "(학생)",
      subject: cls.subject,
      classes: [cls],
      preNotified,
      statuses: [status],
    });
  }
  const all = [...byStudent.values()];
  return {
    absent: all.filter((s) => !attended.has(s.studentId)),
    partial: all.filter((s) => attended.has(s.studentId)),
  };
}

/**
 * 강사 스코프 — 그 강사가 가르치는 반의 결석 칸이 있는 학생만 남기고, 반 목록도 그 반들로 좁힌다.
 * 🔑 결석/일부 결석 판정은 **하루 전체로 이미 끝났다**(좁히기 전에 접는다) — 다른 반에서 출석한 학생을 이 강사 화면에서
 *    '결석'이라 부르지 않게.
 */
export function scopeAbsentDay(day: AbsentDay, classIds: ReadonlySet<string>): AbsentDay {
  const narrow = (list: readonly AbsentStudent[]) =>
    list.flatMap((student) => {
      const classes = student.classes.filter((c) => classIds.has(c.id));
      return classes.length > 0 ? [{ ...student, classes, subject: classes[0]!.subject }] : [];
    });
  return { absent: narrow(day.absent), partial: narrow(day.partial) };
}
