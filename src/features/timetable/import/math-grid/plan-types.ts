// 반영 계획의 모양과 그 해시 — 계획을 세우는 쪽(apply-plan)·쓰는 쪽(서버)·보여 주는 쪽(화면)이 함께 쓴다. 순수.

import type { PeriodTables } from "./period-text";
import type { DeltaIgnored } from "./types";

export interface PlanContext {
  /**
   * 수학 반 전부(종강·폐지 포함) — 새 반 이름이 겹치는지 본다. `open` = 지금 운영 중(폐지도 종강도 아님).
   * `closesOn` = 앞으로 잡힌 종강일(그날부터는 이 반으로 옮기거나 넣을 수 없다).
   * `days` = 지금·앞으로 유효한 수업 요일(mon…). 빈 배열 = 수업 시간이 없는 반. 안 주면 요일을 견주지 않는다.
   */
  classes: { id: string; name: string; open: boolean; closesOn?: string | null; days?: string[] }[];
  students: { id: string; name: string; school: string | null; grade: string | null; status: string | null }[];
  /** 반을 맡길 수 있는 재직자. */
  teachers: { id: string; name: string }[];
  rooms: { id: string; name: string; archived: boolean }[];
  /** **수학 반의** 끝나지 않은 수강(종료일이 없거나 아직 안 지남). `endDate`가 있으면 이동·종료가 이미 예약된 것이다. */
  enrollments: { id: string; studentId: string; classId: string; endDate: string | null }[];
  periods: PeriodTables;
  /** 이 주 시간표가 앞 교시를 건너뛰어 주말 칸의 교시를 믿을 수 없다(schedule-diff `weekendSlotsShifted`) — 주말 새 반을 만들지 않는다. */
  weekendShifted?: boolean;
}

export interface PlanClass {
  key: string;
  name: string;
  teacherId: string;
  teacherName: string;
  classroomId: string | null;
  room: string;
  /** DB에 넣을 수업 시간 한 줄(요일 × 교시 한 칸). */
  slots: { day: string; startTime: string; endTime: string }[];
  /** "수 16:20~18:10 (2교시)" */
  when: string[];
}

/** 옮겨 갈 반 — 이미 있는 반이면 id, 이번에 만드는 반이면 key. */
export interface PlanTarget {
  classId: string | null;
  key: string | null;
  name: string;
  /** 이미 있는 반에 종강일이 잡혀 있으면 그 날짜 — 적용일이 그날 이후면 서버가 적용을 거절한다. */
  closesOn?: string | null;
}

export interface GridApplyPlan {
  classes: PlanClass[];
  moves: { enrollmentId: string; studentId: string; label: string; fromName: string; to: PlanTarget; attendanceDays: string[] }[];
  adds: { studentId: string; label: string; to: PlanTarget; attendanceDays: string[]; onHold: boolean }[];
  removes: { enrollmentId: string; label: string; className: string }[];
  skipped: DeltaIgnored[];
  notes: string[];
  warnings: string[];
}

/** 적용 결과 — 서버 액션이 돌려주고 화면이 그대로 읽는다. */
export type GridApplyState = {
  error?: string;
  /** 해시 불일치 시 서버가 다시 세운 계획의 해시 — 화면이 미리보기를 지우고 다시 불러오게 한다. */
  staleHash?: string;
  applied?: { classes: number; moved: number; added: number; removed: number };
  /** 휴원 학생이라 휴원 표식을 달고 들어간 추가 건수. */
  heldAdds?: number;
  failed?: number;
  effectiveDate?: string;
  snapshotId?: string;
};

/** 스냅샷에 남기는 "이번에 만든 반" — 예약 취소가 이 반을 지운다. */
export type GridCreatedClass = { classId: string; name: string; scheduleIds: string[] };

/** 쓸 것이 몇 건인가. */
export const planSize = (p: GridApplyPlan) => p.classes.length + p.moves.length + p.adds.length + p.removes.length;

/** 결정적 FNV-1a(환경 무관) — 가져오기 diff 해시(import/diff.ts)와 같은 알고리즘. */
function fnv1a(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * **쓸 내용**의 결정적 해시 — 미리보기가 돌려주고, 적용이 방금 다시 세운 계획과 대조한다(그 사이 시트나 수강이
 * 바뀌었으면 멈춘다). 쓰지 않는 것(skipped·notes·warnings)은 쓰기에 영향이 없어 넣지 않는다. 순서 무관.
 */
export function gridPlanHash(plan: GridApplyPlan): string {
  const to = (t: PlanTarget) => t.classId ?? t.key;
  const keys = [
    ...plan.classes.map((c) => `class|${c.key}|${c.name}|${c.teacherId}|${c.classroomId}|${c.slots.map((s) => `${s.day}${s.startTime}${s.endTime}`).sort().join(",")}`),
    ...plan.moves.map((m) => `move|${m.enrollmentId}|${to(m.to)}|${m.attendanceDays.join(",")}`),
    ...plan.adds.map((a) => `add|${a.studentId}|${to(a.to)}|${a.attendanceDays.join(",")}|${a.onHold}`),
    ...plan.removes.map((r) => `remove|${r.enrollmentId}`),
  ].sort();
  return fnv1a(keys.join("\n"));
}
