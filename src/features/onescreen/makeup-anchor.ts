/**
 * 보강 보고서의 **반 한 벌** — 순수 규칙(Vitest). 원장 2026-09-30 확정:
 *  1. *"보고서 반 = 출석부 반은 모든 곳에서 일치. 다르면 크리티컬."*
 *  2. 위임 없이 남의 반 학생을 대신 보강 = **학생의 원래 반(B반)**으로 — 보고서·출석부 모두 B반.
 *  3. 그 칸의 시수는 **실제로 보강한 강사(A)** 몫(`attendance_records.taught_by`, 0316a).
 *  4. 정규 보고서의 반 보드가 없어지면 발송을 막고 안내한다(다른 반으로 보내지 않는다).
 *
 * 🔴 불변식(이 파일이 이름을 붙이고 테스트가 잠근다):
 *    **같은 학생·날짜·과목의 보강 보고서 반(`makeup_class_id`) = 보강 출결 행의 반.**
 *    2026-11-12: `classnote_class_id`는 학부모에게 전달하는 경로다. 학생의 같은 과목 수강·원아 배정을 검증해
 *    별도로 고를 수 있으며 출결·시수·결석분·지도 강사를 바꾸지 않는다. 실제 수업 반 변경만 `changeMakeupAnchor`를 지난다.
 */
import { isClassOpenOn } from "@/features/attendance/makeup-host";
import { isRecallInFlight } from "@/features/report-admin/report-recall";

/** 보강 앵커 후보 한 반 — 담당 반(`mine`)이거나 그날 학생이 다니는 반(`enrolled`). */
export type AnchorCandidate = {
  id: string;
  className: string;
  subject: string;
  closedAt: string | null;
  /** 작성 강사가 그날 담당(담임 ∪ 위임)하는 반. */
  mine: boolean;
  /** 그날 학생이 다니는 반(종료 규약 `isEnrollmentEndedOn` 통과). */
  enrolled: boolean;
};

/**
 * 보강 앵커(`makeup_class_id`)로 **받을 반** — 원장 결정 2(2026-09-30):
 * 강사 담당 반 ∪ 학생이 다니는 반 중 **같은 과목 · 종강 전**. 둘 다 아니면 null(= 저장 오류, 조용히 폴백하지 않는다).
 * 🔴 선택지(`fetchMakeupHostClasses`)·보강 등록 문·보고서 저장·반 바꾸기가 이 함수 **하나**를 쓴다([[#77]]).
 */
export function acceptMakeupAnchor<T extends AnchorCandidate>(
  candidates: readonly T[],
  classId: string | null | undefined,
  subject: string | null | undefined,
  date: string,
): T | null {
  if (!classId || !subject) return null;
  return (
    candidates.find(
      (c) => c.id === classId && c.subject === subject && (c.mine || c.enrolled) && isClassOpenOn(c.closedAt, date),
    ) ?? null
  );
}

/**
 * 대신 보강의 **귀속 강사**(`attendance_records.taught_by`) — 원장 결정 3.
 * 보강한 강사가 그날 그 반을 담당(담임 ∪ 위임)하지 **않으면** 그 칸만 보강한 강사 몫으로 적는다.
 * 담당 반이면 null(= 종전 축 그대로 — 담임·교시 담당 판정, teacher-axis.ts).
 */
export function substituteTaughtBy(ownerId: string | null | undefined, anchorIsMine: boolean): string | null {
  return ownerId && !anchorIsMine ? ownerId : null;
}

/** 보강 보고서인가(반 없는 보강 행) — 앵커는 이 행에만 의미가 있다(0171a). */
export function isMakeupReportRow(r: { makeup?: boolean | null; classId?: string | null }): boolean {
  return !!r.makeup && !r.classId;
}

/**
 * 보강 보고서의 저장된 전달 반(없으면 보강 반). 실제 게시 전에 수강·원아 배정을 별도로 검증한다.
 */
export function makeupSendClassOf(r: { makeup?: boolean | null; classId?: string | null; makeupClassId?: string | null; classnoteClassId?: string | null }): string | null {
  return isMakeupReportRow(r) ? (r.classnoteClassId ?? r.makeupClassId ?? null) : null;
}

/** 불변식 위반 종류 — 드라이런 스크립트·경로 테스트가 같은 이름을 쓴다. */
export type MakeupInvariantViolation =
  /** 반별 발송 대상인데 보강 반이 없다('반 미정'). */
  | "no_anchor"
  /** 앵커 반에 그날 그 학생 출결 칸이 없다. */
  | "no_cell_in_anchor"
  /** 앵커가 아닌 반(보이지 않는 보강 반 등)에 보강 칸이 따로 있다. */
  | "cell_outside_anchor"
  /** @deprecated 전달 반은 별도 검증한다. 출결 검사에서는 더 이상 발생하지 않는다. */
  | "send_class_differs";

/**
 * **불변식 검사**(순수) — 보강 보고서 한 건과 그날 그 학생의 보강 칸들.
 * @param cells 그날 그 학생의 **유효** 출결 칸 중 이 보강에 속할 수 있는 것 — 앵커 반의 칸 전부 + 앵커 밖의 `makeup` 칸.
 * @param requireAnchor 반별 발송 대상(수학 · 경로 켜짐)인가 — 대상이면 앵커 없음 자체가 위반이다.
 */
export function makeupInvariantViolations(input: {
  report: { makeup: boolean; classId: string | null; makeupClassId: string | null; classnoteClassId: string | null };
  cells: readonly { classId: string; status: string }[];
  requireAnchor: boolean;
}): MakeupInvariantViolation[] {
  const r = input.report;
  if (!isMakeupReportRow(r)) return [];
  const out: MakeupInvariantViolation[] = [];
  const anchor = r.makeupClassId;
  if (!anchor) {
    if (input.requireAnchor) out.push("no_anchor");
    return out;
  }
  if (!input.cells.some((c) => c.classId === anchor)) out.push("no_cell_in_anchor");
  if (input.cells.some((c) => c.classId !== anchor && c.status === "makeup")) out.push("cell_outside_anchor");
  // 전달 경로는 출결 불변식과 별개다. 수강·원아 배정 검증은 발송 게이트가 담당한다.
  return out;
}

/** 옮길 칸 한 줄(출결 행 최소 모양 — append-only 이력 포함). */
export type MoveCellRow = {
  id: string;
  classId: string;
  status: string;
  slotStart: string | null;
  recordedAt: string;
};

/**
 * 보강 반을 A→B로 바꿀 때 **출결 칸을 어떻게 옮기나**(순수).
 * @param fromRows 옛 자리(옛 앵커 반 또는 보이지 않는 보강 반)의 그날 그 학생 행 **전부**(정정 이력 포함).
 * @param toRows   새 앵커 반의 그날 그 학생 행 전부.
 * @param fromIsPool 옛 자리가 보이지 않는 보강 반인가(그 반엔 보강만 산다 — 상태를 따지지 않는다).
 *
 * 규칙:
 *  · 옮길 게 없으면(`fromRows` 없음) → `none`(새 반엔 저장 훅이 칸을 세운다).
 *  · 옛 자리의 **유효** 행 중 보강(`makeup`)이 아닌 것이 있으면(정규 칸에 시수를 얹은 '분리' 보강 등) → `blocked`
 *    — 정규 칸을 통째로 옮기면 정규 출석이 사라진다. 사람이 정리해야 한다.
 *  · 새 반에 이미 칸이 있으면 → `blocked`(두 칸이 겹치면 최신 한 행만 유효해 시수가 조용히 사라진다 — effective-records.ts).
 *  · 그 밖 → `move`(행 id 전부의 반만 바꾼다 — 시수·메모·입력자·이력 보존).
 */
export type MoveCellsPlan =
  | { kind: "none" }
  | { kind: "move"; ids: string[] }
  | { kind: "blocked"; reason: "regular_cell_in_old_class" | "target_has_cell" };

export function planMakeupCellMove(input: {
  fromRows: readonly MoveCellRow[];
  toRows: readonly MoveCellRow[];
  fromIsPool: boolean;
}): MoveCellsPlan {
  if (input.fromRows.length === 0) return { kind: "none" };
  if (!input.fromIsPool) {
    const latest = new Map<string, MoveCellRow>();
    for (const r of input.fromRows) {
      const k = r.slotStart ?? "";
      const prev = latest.get(k);
      if (!prev || r.recordedAt > prev.recordedAt || (r.recordedAt === prev.recordedAt && r.id > prev.id)) latest.set(k, r);
    }
    if ([...latest.values()].some((r) => r.status !== "makeup")) return { kind: "blocked", reason: "regular_cell_in_old_class" };
  }
  if (input.toRows.length > 0) return { kind: "blocked", reason: "target_has_cell" };
  return { kind: "move", ids: input.fromRows.map((r) => r.id) };
}

/** `blocked` 사유 → 화면 문장(한국어 — 서버·화면 한 벌). */
export const MOVE_BLOCKED_MESSAGE: Record<"regular_cell_in_old_class" | "target_has_cell", string> = {
  regular_cell_in_old_class:
    "보강 반에 보강 전용이 아닌 출결 기록이 있어 자동으로 옮길 수 없습니다 — 출석부에서 해당 기록을 확인해 주세요",
  target_has_cell:
    "새 반에 그날 이 학생 출결 칸이 이미 있어 보강을 옮길 수 없습니다 — 출석부에서 그 칸을 먼저 확인해 주세요",
};

/** 보강 반을 바꿀 수 없는 발송 상태 — 이미 게시됐거나(회수가 옛 반 기록을 본다) 워커가 집었다. */
export function makeupAnchorLockedReason(r: {
  classnoteStatus: string | null;
  classnoteSentAt: string | null;
}): string | null {
  if (r.classnoteSentAt || r.classnoteStatus === "success")
    return "이미 학부모에게 발송된 보강 보고서라 반을 바꿀 수 없습니다";
  if (r.classnoteStatus === "processing") return "지금 발송 중인 보고서라 반을 바꿀 수 없습니다 — 잠시 뒤 다시 시도해 주세요";
  if (isRecallInFlight(r.classnoteStatus))
    return "회수 처리 중인 보고서라 반을 바꿀 수 없습니다";
  return null;
}

/** 반별 발송 대상 보강인데 반이 없을 때(원장 2026-09-30 '반 미정') — 저장·발송 전 반 선택을 요구하는 문장. */
export const MAKEUP_ANCHOR_REQUIRED_ERROR =
  "보강 반이 정해지지 않았습니다 — 이 보강을 어느 반 수업으로 기록할지 먼저 골라 주세요(반 미정 보강은 저장·발송할 수 없습니다)";

/** 받을 수 없는 반을 보낸 경우(남의 반·다른 과목·종강 반) — 조용히 옛 값으로 두지 않고 저장을 거절한다. */
export const MAKEUP_ANCHOR_REJECTED_ERROR =
  "고른 보강 반을 받을 수 없습니다 — 선생님 담당 반이거나 이 학생이 다니는 같은 과목·종강 전 반이어야 합니다";
