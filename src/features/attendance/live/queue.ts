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
  slotStart: string; // "HH:MM" — 표시·앵커
  /** 출결 정정에 실을 교시 값(slot-axis) — 수학은 null("그날 전체"). */
  saveSlot: string | null;
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
  /** 그 조치를 남길 때의 신호 — 나중에 결석으로 올라섰는지 판정하는 근거(isSettled). */
  signal: string | null;
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
  /** 이 (반·저장축)에 실을 교시 값 — 수학은 null("그날 전체"). 카드 접기와 요청 dedup의 키. */
  saveSlot: string | null;
  /** 이미 '출결 입력 요청'을 보낸 카드인가 — 중복 전화를 막는 유일한 표식. */
  requested: boolean;
  /**
   * 이 카드에 접힌 교시 수(기본 1). 수학처럼 **하루 한 행**이 규약인 과목은 연강 2~3교시가 한 칸이라
   * 카드도 한 장이다 — 접힌 교시가 있으면 화면이 "1~3교시"로 밝힌다.
   */
  slotCount: number;
  /** 접힌 마지막 교시("HH:MM") — 한 장이면 slotStart와 같다. */
  slotEnd: string;
};

export type DeskQueue = {
  lanes: { classes: QueueClass[]; students: QueueStudent[] };
  /** 오늘 이미 매듭지은 건(처리·보류) — 목록에서 지우지 않고 결말을 보인다. */
  done: QueueStudent[];
  counts: { classes: number; students: number; done: number };
};

/**
 * 후속조치가 매듭지어졌는가 — open(진행 중)은 아직 큐에 남는다.
 *
 * 🔴 **신호가 그 뒤에 `absent`로 올라섰으면 다시 연다.** 실측(2026-08-14): 결석 266건 중 **113건(42.5%)이
 *    수업 다음날 이후에 기록**된다. 즉 "오전에 미확인으로 한 번 내렸다가 저녁에 강사가 결석을 찍는" 순서가
 *    예외가 아니라 **기본 흐름**이다. 상태만 보고 닫아두면 그 결석은 데스크에 영영 안 뜬다.
 * ⚠️ 이미 `absent`를 보고 매듭지은 건(조치의 signal도 absent)은 다시 열지 않는다 — 그건 같은 사실이다.
 */
export function isSettled(f: FollowupBrief | null, currentSignal?: LiveSignal): boolean {
  if (f == null) return false;
  if (f.state !== "resolved" && f.state !== "dismissed") return false;
  if (currentSignal === "absent" && f.signal !== "absent") return false; // 결석으로 승격 → 재개봉
  return true;
}

/**
 * 학생 줄 정렬 — ① 아직 안 매듭진 것 ② 신호가 확실한 순(결석 > 미확인) ③ **교시가 이른 순**.
 *
 * ③이 시각 역순이 아닌 이유: 데스크가 먼저 손대야 하는 건 방금 생긴 건이 아니라 **가장 오래 방치된**
 * 건이다. 하원 시간이 다가오는 아이부터 확인해야 셔틀·귀가가 어긋나지 않는다.
 */
export function compareStudents(a: QueueStudent, b: QueueStudent): number {
  const settled = Number(isSettled(a.followup, a.signal)) - Number(isSettled(b.followup, b.signal));
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
  // 🔴 같은 (학생, 저장축)은 **한 장**이다. 수학은 하루 한 행이 규약인데(slot-axis) 화면은 교시별로
  //    도니, 연강 3교시 반이면 같은 아이가 카드 3장으로 나와 데스크가 같은 집에 세 번 전화한다
  //    (실측: 오늘 수학 19반 중 17반이 2~3교시). 신호가 센 쪽(결석)을 남긴다.
  const seen = new Map<string, QueueStudent>();
  for (const s of students) {
    if (s.signal === "class_unmarked") continue; // 반 단위로 접힌다
    const key = `${s.studentId}|${s.classId}|${s.saveSlot ?? ""}`;
    const prev = seen.get(key);
    if (!prev || SIGNAL_RANK[s.signal] > SIGNAL_RANK[prev.signal]) seen.set(key, s);
  }
  for (const s of seen.values()) {
    (isSettled(s.followup, s.signal) ? done : open).push(s);
  }
  open.sort(compareStudents);
  done.sort(compareStudents);
  // 🔴 레인 A도 **저장축으로 접는다**. 수학은 하루 한 행이라 연강 3교시가 한 칸인데 카드를 3장 내면
  //    ① '확인 필요' 배지가 3배로 부풀고(반 3개인 줄 안다) ② 데스크가 같은 강사에게 세 번 손댄다.
  //    영어(교시별 저장)는 교시마다 진짜 빈 칸이므로 접지 않는다 — 접는 키에 saveSlot이 들어간 이유다.
  const foldedClasses = new Map<string, QueueClass>();
  for (const c of classes) {
    const key = `${c.classId}|${c.saveSlot ?? ""}`;
    const prev = foldedClasses.get(key);
    if (!prev) {
      foldedClasses.set(key, { ...c, slotCount: 1, slotEnd: c.slotStart });
      continue;
    }
    // 이른 교시를 대표로 남긴다 — 가장 오래 방치된 칸이 먼저 눈에 와야 한다(compareStudents와 같은 이유).
    const first = c.slotStart < prev.slotStart ? c : prev;
    foldedClasses.set(key, {
      ...first,
      expected: Math.max(prev.expected, c.expected),
      slotCount: prev.slotCount + 1,
      slotEnd: c.slotStart > prev.slotEnd ? c.slotStart : prev.slotEnd,
    });
  }
  const laneClasses = [...foldedClasses.values()].sort(compareClasses);
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
