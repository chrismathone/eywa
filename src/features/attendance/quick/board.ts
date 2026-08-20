/**
 * '출결 모드'가 그리는 **카드 목록** — 순수 함수(Vitest).
 *
 * 원장 2026-08-20: *"개별 강사뷰에서 '출결 모드' 신설 탭 만들고, 사진처럼 출결만 가능하게 간단하게."*
 * (붙인 사진 = 지금의 좌석표) — 그래서 **적재도 접는 규칙도 좌석표 그대로**를 쓴다.
 *
 * 🔴 **새 조회·새 접기 규칙을 만들지 않는다.** 카드는 [`foldSeating`](../live/seating.ts)이 만든
 *    그 객체이고, 저장 축(`student.writeSlot` · `klass.firstStart`)도 좌석표 칸과 **같은 값**이다.
 *    여기서 축을 새로 계산하면 같은 반이 화면마다 다른 교시에 저장돼 시수(→ 급여)가 갈린다
 *    ([slot-axis.ts](../live/slot-axis.ts)). 이 화면의 유일한 실패 모드가 그것이다.
 * ⚠️ 좌석표와 **다른 점은 두 가지뿐**이다:
 *      ① 층·강의실 묶음(`seating-floors`)을 쓰지 않는다 — 강사 반은 몇 개뿐이라 묶음이 방해다.
 *      ② **자리(LAB·JJ) 교시를 뺀다** — 그 칸은 자리 담당이 `/attendance/seat/*`에서 찍는 자리이고,
 *         강사 홈 스트립도 같은 이유로 이미 빼고 있다([today-strip.tsx](../live/components/today-strip.tsx)).
 *         빼도 수학은 손해가 없다: 자리 교시가 섞인 반도 저장 축이 "그날 전체"(null)라 같은 칸을 쓴다.
 */
import { isSpecialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { seatMarkOf } from "../live/mark-state";
import { foldSeating, seatingSummary, type SeatingClass, type SeatingStudent } from "../live/seating";
import type { LiveBoard } from "../live/types";

export type QuickClass = SeatingClass;
export type QuickStudent = SeatingStudent;
export type QuickCell = { studentId: string; classId: string };

/** 낙관 반영·시트 대상의 키 — (반 × 학생). 출결 원장이 그 조합에 한 칸이다. */
export function quickCellKey(classId: string, studentId: string): string {
  return `${classId}::${studentId}`;
}

/**
 * 보드 → 카드 목록(교시 시각 순, 같은 시각이면 반 이름 순 — `foldSeating`의 정렬 그대로).
 * 호출부는 반드시 `getLiveBoard(date, true)`(selfOnly = 내 수업만)로 얻은 보드를 넘긴다.
 */
export function quickClasses(board: LiveBoard): QuickClass[] {
  const slots = board.teachers
    .flatMap((t) => t.slots)
    .filter((s) => !isSpecialSlotLabel(s.slotTeacherLabel));
  return foldSeating(slots);
}

/** 화면 머리 숫자(미출결·결석·입력·전체) — 좌석표 요약과 **같은 계산**이라 두 화면이 다른 말을 안 한다. */
export const quickSummary = seatingSummary;

/** 그 반이 다 찍혔나 — 접기 판정의 단일 소스. */
export function isFullyMarked(klass: QuickClass): boolean {
  return klass.students.length > 0 && klass.students.every((s) => s.status != null);
}

/**
 * 처음 열 때 **접어 둘 반**(= 이미 다 찍은 반) — 스크롤을 줄이는 게 이 화면의 목적이다.
 * 🔑 판정은 **첫 렌더 한 번**이다. 마지막 학생을 찍는 순간 카드가 눈앞에서 접히면 방금 누른 칩이
 *    사라져 "잘못 눌렀나"가 된다 — 작업 중 접히지 않게 소비처가 이 값을 state 초기값으로만 쓴다.
 */
export function initiallyCollapsed(classes: readonly QuickClass[]): Set<string> {
  return new Set(classes.filter(isFullyMarked).map((c) => c.classId));
}

export type QuickBulkPlan = {
  /** `setAttendanceBulk({ slotStart })`에 실을 **저장 축** — 수학은 null("그날 전체"), 영어는 교시. */
  slot: string | null;
  cells: QuickCell[];
};

/**
 * '일괄 출결 N' — **미입력 칸만** 전원 출석(`fillEmptyOnly`). 이미 찍힌 칸은 대상이 아니다.
 *
 * 🔑 축은 학생의 `writeSlot`을 **그대로** 쓴다(반에서 다시 계산하지 않는다). 카드 머리의 시각은
 *    '지금 교시'(anchor)라 하루 첫 교시와 다를 수 있어, 거기서 축을 뽑으면 영어 반이 조용히 다른
 *    교시에 저장된다(`seating.ts`의 firstStart 주석 참조).
 * ⚠️ 빈 칸은 정의상 같은 축을 갖지만(기록이 없으면 `saveSlotFor(과목, 하루 첫 교시)` 하나뿐),
 *    혹시 갈리면 **다른 축은 넣지 않는다** — 라벨 N과 실제로 보내는 칸 수가 어긋나지 않게.
 */
export function bulkPlan(klass: QuickClass): QuickBulkPlan {
  const empty = klass.students.filter((s) => s.status == null);
  const slot = empty[0]?.writeSlot ?? null;
  return {
    slot,
    cells: empty
      .filter((s) => (s.writeSlot ?? null) === slot)
      .map((s) => ({ studentId: s.studentId, classId: klass.classId })),
  };
}

/** 낙관 반영 한 칸 — 서버 응답을 기다리는 동안(그리고 그 뒤로도) 화면이 믿는 값. */
export type QuickMark = { status: string | null; note: string | null };

/**
 * 서버가 내려준 카드에 **낙관 반영을 덮어** 화면이 그릴 목록을 만든다.
 *
 * 🔴 요약 숫자(`quickSummary`)도 반드시 이 결과에서 뽑아야 한다 — 원본에서 뽑으면 방금 찍은 학생이
 *    "미출결 N명"에 그대로 남아 화면이 스스로와 다른 말을 한다.
 * 🔑 표시 상태(`mark`)는 [`seatMarkOf`](../live/mark-state.ts) **단일 소스**로 다시 계산한다. 여기서
 *    직접 색·라벨을 고르면 좌석표와 같은 값이 다른 색으로 보인다(팔레트 v4 캐논).
 */
export function applyQuickMarks(
  classes: readonly QuickClass[],
  marks: Readonly<Record<string, QuickMark>>,
): QuickClass[] {
  if (Object.keys(marks).length === 0) return classes as QuickClass[];
  return classes.map((c) => ({
    ...c,
    students: c.students.map((s) => {
      const hit = marks[quickCellKey(c.classId, s.studentId)];
      if (!hit) return s;
      return { ...s, status: hit.status, note: hit.note, mark: seatMarkOf(hit.status, c.phase) };
    }),
  }));
}

/** 출결 모드가 쓰는 상태 3종 — 조퇴·공결·보강은 출석부 전용이다(축약 되쓰기 방지, 일괄과 같은 계약). */
export type QuickMarkStatus = "present" | "late" | "absent";

/** 사유 메모를 **그 상태가 쓴 것**으로 보는 상태들 — 상태가 바뀌면 그 메모는 더 이상 사실이 아니다. */
const REASON_OWNED = new Set(["absent", "excused", "late"]);

/**
 * 상태를 바꿀 때 기존 메모를 어떻게 할 것인가 — `null`이면 비우고, `undefined`면 **건드리지 않는다**
 * (서버 계약: `note`를 안 넘기면 기존 메모 유지).
 *
 * 🔑 결석 사유(`여행`)와 지각 메모(`17:05 등원`)는 **그 상태의 설명**이다. 결석을 출석으로 고쳤는데
 *    `여행`이 남거나, 지각을 결석으로 고쳤는데 `17:05 등원`이 결석 사유 자리에 남으면 데스크가
 *    그 문장을 보고 전화를 건다.
 * 🔴 반대로 **출석·보강 칸의 메모는 절대 안 지운다** — 보강 연결(`linkMakeupToAbsence`)이 남긴 흔적처럼
 *    이 화면이 쓴 것이 아닌 기록이 들어 있다.
 */
export function noteOnStatusChange(
  prev: string | null,
  next: QuickMarkStatus,
): null | undefined {
  if (prev == null || prev === next) return undefined;
  // 결석↔공결은 같은 뜻이라 사유가 그대로 유효하다.
  if (next === "absent" && prev === "excused") return undefined;
  return REASON_OWNED.has(prev) ? null : undefined;
}
