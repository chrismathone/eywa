/**
 * 당일 출결의 **표시 상태**와 **데스크 입력 범위** — 순수 함수(Vitest).
 *
 * 원장(2026-08-14 추가): *"교시 시작 후 10분안에 미체크하면 미출결로. 출결할 시간은 10분만 줄것.
 * 데스크도 가능하게. 하지만 10분 이후 미출결건에 대하여 수정할때만."*
 *
 * 🔴 10분은 **입력 잠금이 아니라 표시·전달 기준**이다. 강사는 10분이 지나도 계속 찍는다
 *    (알림 규칙이 "강사가 미출결→출결로 바꾸면"을 전제하므로). 데스크만 이 선 밖의 빈 칸만 손댄다.
 * 판정은 읽는 시점 계산 — 상태를 DB에 적어 두면 10분마다 배치가 필요해진다.
 */
import type { RecordedVia } from "./recorded-via";
import { ATTENDANCE_GRACE_MIN, type SlotPhase } from "./signals";

export { ATTENDANCE_GRACE_MIN };

/** 좌석표·요약이 쓰는 5색. raw enum을 화면에 내보내지 않는다. */
export type SeatMark = "present" | "absent" | "late" | "unmarked" | "waiting";

export const SEAT_MARK_LABEL: Record<SeatMark, string> = {
  present: "출석",
  absent: "결석",
  late: "지각",
  unmarked: "미출결",
  waiting: "대기",
};

/**
 * 출석부 `--att-*` 토큰만 쓴다(새 팔레트 금지).
 * 미출결은 기록 전 민트(`classday`)와 구별되게 진한 회색(`outside`).
 */
export const SEAT_MARK_TONE: Record<SeatMark, string> = {
  present: "bg-att-present text-att-present-ink",
  absent: "bg-att-absent text-att-absent-ink",
  late: "bg-att-late text-att-late-ink",
  unmarked: "bg-att-outside text-att-absent-ink",
  waiting: "bg-att-classday text-text-dim",
};

/** 마우스오버 — 결석이면 사유 메모를 둘째 줄에. */
export function seatHoverTitle(input: {
  studentName: string;
  schoolGrade?: string | null;
  mark: SeatMark;
  note?: string | null;
}): string {
  const bits = [input.studentName];
  if (input.schoolGrade) bits.push(input.schoolGrade);
  bits.push(SEAT_MARK_LABEL[input.mark]);
  const head = bits.join(" · ");
  const note = input.note?.trim();
  if (input.mark === "absent" && note) return `${head}\n${note}`;
  return head;
}

/** 그 칸의 표시 상태 — 기록이 있으면 그 값, 없으면 국면으로 대기/미출결. */
export function seatMarkOf(status: string | null, phase: SlotPhase): SeatMark {
  if (status === "present" || status === "makeup") return "present";
  if (status === "absent" || status === "excused") return "absent";
  if (status === "late" || status === "early_leave") return "late";
  if (status != null) return "present"; // 알 수 없는 값은 '왔다' 쪽으로 — 빈 칸으로 오인하지 않는다
  if (phase === "before" || phase === "grace") return "waiting";
  return "unmarked";
}

/**
 * 데스크 10분 게이트를 켤 화면인가.
 * `"live"` = 당일 출결(보드·확인 큐·좌석표). 없으면 종전 권한(월간 격자·원스크린·시트).
 * 권한을 **좁히기만** 하므로 클라가 위조해도 넣으면 더 막힐 뿐(#77 예외 — 원장 범위가 당일 화면).
 */
export function shouldEnforceDeskGate(source?: string | null): boolean {
  return source === "live";
}

/**
 * 데스크가 이 칸을 쓸 수 있는가.
 * · 이미 찍힌 칸(출석/결석/지각)은 **덮지 못한다**
 * · 유예 안(대기)은 강사 몫
 * · 유예 경과 뒤의 빈 칸(미출결)만
 */
export function canDeskMark(status: string | null, phase: SlotPhase): boolean {
  if (status != null) return false;
  return phase === "due" || phase === "ended";
}

const DESK_ALREADY_MARKED = "이미 입력된 출결은 데스크가 덮을 수 없습니다 — 미출결 칸만 처리할 수 있습니다";
const DESK_CLEAR_DENIED = "데스크는 미출결 칸만 입력할 수 있습니다 — 이미 있는 기록을 지울 수 없습니다";

/** 데스크 거절 사유 — 서버 액션이 같은 함수로 메시지를 만든다(#77). */
export function deskMarkDeniedReason(status: string | null, phase: SlotPhase): string | null {
  if (canDeskMark(status, phase)) return null;
  if (status != null) return DESK_ALREADY_MARKED;
  if (phase === "before") return "아직 수업 시작 전입니다 — 시작 후 10분이 지나야 데스크가 입력할 수 있습니다";
  return `수업 시작 후 ${ATTENDANCE_GRACE_MIN}분이 지나야 데스크가 입력할 수 있습니다`;
}

/**
 * 이 쓰기를 데스크 게이트가 막는가. `assertDeskMayWrite`의 순수 판정.
 * 플래그 없음 = 종전 권한 — 담당이 아닌 master(via=desk)도 기존 기록을 고친다.
 */
export function deskWriteDenied(input: {
  source?: string | null;
  via: RecordedVia;
  currentStatus: string | null;
  nextStatus: string | null;
  phase: SlotPhase;
}): string | null {
  if (!shouldEnforceDeskGate(input.source)) return null;
  if (input.via !== "desk") return null;
  if (input.nextStatus === null) return DESK_CLEAR_DENIED;
  return deskMarkDeniedReason(input.currentStatus, input.phase);
}

/** 출석으로 본 상태 — 미출결→출결 알림의 '출결' 쪽. 지각·조퇴·보강도 '왔다'. */
export function isArrivalStatus(status: string | null | undefined): boolean {
  return status === "present" || status === "late" || status === "early_leave" || status === "makeup";
}

/**
 * 미출결 → 출결 전이인가. 기록이 없던 칸에 '왔다'가 찍힌 순간만.
 * 결석으로 바꾸는 건 이 알림의 대상이 아니다(결석은 기존 데스크 벨).
 */
export function isUnmarkedToArrival(prev: string | null | undefined, next: string | null | undefined): boolean {
  return prev == null && isArrivalStatus(next);
}

/** 누가 미출결→출결을 찍었는가 → 알림이 갈 쪽. */
export type CrossNotifyDirection = "to_teacher" | "to_desk";

export function crossNotifyDirection(via: "teacher" | "desk" | "seat" | "kiosk"): CrossNotifyDirection | null {
  if (via === "desk") return "to_teacher";
  if (via === "teacher") return "to_desk";
  return null; // 자리·키오스크는 교차 알림 대상이 아님
}

/** 좌석 칸에 넣을 짧은 이름 — 한국 이름은 3자면 그대로, 길면 앞 3자. */
export function shortSeatName(name: string): string {
  const t = name.trim();
  return t.length <= 3 ? t : t.slice(0, 3);
}
