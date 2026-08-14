/**
 * 데스크 확인 큐 조립 — 순수 함수(Vitest). 신호(signals.ts)를 **두 레인**으로 갈라 정렬한다.
 *
 * 🔴 두 레인이 이 기능의 안전장치다. 실측상 매일 200명 이상이 `unmarked`인데(재원 374명 중 하루 기록
 *    91~153명), 그걸 전부 "안 온 학생"으로 데스크에 쏟으면 하루 200통을 걸어야 하고 그중 대부분은
 *    교실에 앉아 있다. 한 번의 헛전화가 학부모 신뢰를 깎는 기능은 켜자마자 꺼진다.
 *
 *   · **레인 A(반)** = 그 교시 출결이 통째로 비어 있음 → 대상은 학생이 아니라 **강사**.
 *     "출석부 열어주세요" 한 통이 학생 12명분 확인을 대신한다. 영어 91.6% 공백이 여기로 접힌다.
 *   · **레인 B(학생)** = 결석으로 찍혔거나, 같은 교시 다른 학생은 찍혔는데 이 학생만 빈 칸 →
 *     **학부모·학생 확인**. 강사가 출석부를 열었다는 사실이 "이 아이만 없다"의 근거가 된다.
 *
 * ⚠️ 처리한 건을 곧바로 목록에서 지우지 않는다(#105) — 마지막 날까지 보이던 행이 다음 순간 증발하면
 *    "처리했는데 사라졌다/못 했는데 사라졌다"가 구분되지 않는다. `done` 배열로 따로 내려 화면이 결말을 보인다.
 */

import { SIGNAL_RANK, type LiveSignal, type SlotPhase } from "./signals";

/** 큐 한 줄(학생) — 화면·정렬이 함께 쓰는 최소 형태. */
export type QueueStudent = {
  studentId: string;
  studentName: string;
  schoolGrade: string | null; // 이미 압축된 표기("경명여중1") — 조립은 호출부
  classId: string;
  className: string;
  slotStart: string; // "HH:MM"
  teacherName: string | null;
  signal: LiveSignal;
  phase: SlotPhase;
  /** 강사가 남긴 사유 메모 — 전화 전에 읽어야 헛전화가 줄어든다("감기로 결석"·보강 연결 흔적). */
  note: string | null;
  parentPhone: string | null;
  studentPhone: string | null;
  /** 이 (학생·날짜·교시)에 이미 남긴 후속조치 — 없으면 null. */
  followup: FollowupBrief | null;
};

export type FollowupBrief = {
  id: string;
  state: string; // open | resolved | dismissed
  outcome: string | null;
  note: string | null;
  handledByName: string | null;
  handledAt: string | null;
};

/** 큐 한 줄(반) — 강사에게 거는 카드. */
export type QueueClass = {
  classId: string;
  className: string;
  subject: string;
  slotStart: string;
  teacherId: string | null;
  teacherName: string | null;
  teacherPhone: string | null;
  /** 자리 반 표기(LAB·JJ) — 담당자가 사람이 아닌 슬롯을 "담당 미지정"으로 뭉치지 않게. */
  slotTeacherLabel: string | null;
  expected: number; // 그날 예정 학생 수 — "12명이 통째로 비어 있음"을 보여준다
  phase: SlotPhase;
};

export type DeskQueue = {
  lanes: { classes: QueueClass[]; students: QueueStudent[] };
  /** 오늘 이미 매듭지은 건(처리·보류) — 목록에서 지우지 않고 결말을 보인다. */
  done: QueueStudent[];
  counts: { classes: number; students: number; done: number };
};

/** 후속조치가 매듭지어졌는가 — open(진행 중)은 아직 큐에 남는다. */
export function isSettled(f: FollowupBrief | null): boolean {
  return f != null && (f.state === "resolved" || f.state === "dismissed");
}

/**
 * 학생 줄 정렬 — ① 아직 안 매듭진 것 ② 신호가 확실한 순(결석 > 미확인) ③ **교시가 이른 순**.
 *
 * ③이 시각 역순이 아닌 이유: 데스크가 먼저 손대야 하는 건 방금 생긴 건이 아니라 **가장 오래 방치된**
 * 건이다. 하원 시간이 다가오는 아이부터 확인해야 셔틀·귀가가 어긋나지 않는다.
 */
export function compareStudents(a: QueueStudent, b: QueueStudent): number {
  const settled = Number(isSettled(a.followup)) - Number(isSettled(b.followup));
  if (settled !== 0) return settled;
  const rank = SIGNAL_RANK[b.signal] - SIGNAL_RANK[a.signal];
  if (rank !== 0) return rank;
  if (a.slotStart !== b.slotStart) return a.slotStart < b.slotStart ? -1 : 1;
  return a.studentName.localeCompare(b.studentName, "ko");
}

/** 반 줄 정렬 — 교시 이른 순, 같으면 인원 많은 순(한 통으로 더 많이 걷히는 쪽 먼저). */
export function compareClasses(a: QueueClass, b: QueueClass): number {
  if (a.slotStart !== b.slotStart) return a.slotStart < b.slotStart ? -1 : 1;
  if (a.expected !== b.expected) return b.expected - a.expected;
  return a.className.localeCompare(b.className, "ko");
}

/**
 * 신호 목록 → 두 레인.
 *
 * ⚠️ `class_unmarked` 학생은 **레인 B에 절대 넣지 않는다**(위 🔴). 대신 그 (반,교시)가 레인 A에 한 장 뜬다.
 *    레인 A 카드는 호출부가 만들어 넘긴다 — 여기선 "학생을 B에 넣을지"만 판정한다.
 */
export function buildQueue(students: readonly QueueStudent[], classes: readonly QueueClass[]): DeskQueue {
  const open: QueueStudent[] = [];
  const done: QueueStudent[] = [];
  for (const s of students) {
    if (s.signal === "class_unmarked") continue; // 반 단위로 접힌다
    (isSettled(s.followup) ? done : open).push(s);
  }
  open.sort(compareStudents);
  done.sort(compareStudents);
  const laneClasses = [...classes].sort(compareClasses);
  return {
    lanes: { classes: laneClasses, students: open },
    done,
    counts: { classes: laneClasses.length, students: open.length, done: done.length },
  };
}

/**
 * 후속조치 결과 — 데스크가 전화 후 고르는 값. **출결 상태와 1:1로 매핑하지 않는다**(아래 🔴).
 */
export const FOLLOWUP_OUTCOMES = [
  { value: "coming", label: "곧 옴 (늦게 출발)" },
  { value: "absent_today", label: "오늘 안 옴 (확인됨)" },
  { value: "sick", label: "아파서 결석" },
  { value: "already_here", label: "이미 와 있음 (강사 미입력)" },
  { value: "no_answer", label: "연락 안 됨" },
  { value: "other", label: "기타 (메모)" },
] as const;

export type FollowupOutcome = (typeof FOLLOWUP_OUTCOMES)[number]["value"];

export const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(
  FOLLOWUP_OUTCOMES.map((o) => [o.value, o.label]),
);

/**
 * 그 결과가 **출결 기록으로 바꿔 제안할 만한가** — 제안일 뿐 자동 반영이 아니다.
 *
 * 🔴 `attendance_records`는 시수(session_units)·단가(salary_tier)를 통해 **급여와 청구로 흘러간다**
 *    (골든마스터 대상). 데스크의 전화 한 통이 강사 급여를 조용히 바꾸면 안 된다. 그래서 여기서는
 *    "이 상태로 바꾸시겠습니까?" 버튼에 쓸 값만 돌려주고, 실제 쓰기는 사람이 누른 뒤 기존 게이트
 *    (`setAttendanceCell`)를 그대로 통과한다.
 * ⚠️ `no_answer`·`coming`·`other`는 **아무 것도 제안하지 않는다** — 연락이 안 됐다는 사실은
 *    학생이 안 왔다는 뜻이 아니다.
 */
export function suggestedStatus(outcome: string): "present" | "absent" | null {
  if (outcome === "already_here") return "present";
  if (outcome === "absent_today" || outcome === "sick") return "absent";
  return null;
}
