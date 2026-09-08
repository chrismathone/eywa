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
import {
  DAY_TONE,
  STATUS_TEXT,
  STATUS_TEXT_EN,
  STATUS_TONE,
  type AttendanceMark,
} from "@/features/attendance/cell-display";
import type { RecordedVia } from "./recorded-via";
import { ATTENDANCE_GRACE_MIN, type SlotPhase } from "./signals";

export { ATTENDANCE_GRACE_MIN };

/**
 * 좌석표·요약이 쓰는 표시 상태 = **출석부의 6상태 + 기록이 없는 두 칸**(대기·미출결).
 *
 * 🔴 2026-09-08 원장 지시 *"전부 통일된 뷰가 있도록 버그 수정"* — 종전엔 5색이었고 `seatMarkOf`가
 *    **보강을 출석에, 조퇴를 지각에 접었다**. 그래서 같은 기록을 월별 출석부·학생 달력·반별 출석부는
 *    `보강`(보라)이라 부르는데 좌석표·출결 모드·오늘 출결만 **출석(초록)**이라 했다.
 *    실측 2026-09-04 권형준(중등E_중1 정규 A)이 그 예이고, 최근 90일 보강 63건 중 20건이 칸으로
 *    그려져 초록이었다. 출결은 매일 보는 화면이라 이건 색이 아니라 **사실이 갈린 것**이다.
 * 🔑 라벨·색을 여기서 새로 적지 않는다 — `cell-display`(출석부 정본)의 표를 **그대로 편다**.
 *    두 화면이 같은 표를 읽으면 구조적으로 다시 갈릴 수 없다.
 * ⚠️ `excused`(공결)만은 정본도 결석과 **같은 라벨·같은 색**이라 그 접기를 그대로 둔다
 *    (`seatMarkOf` 주석 참조) — 여기서 갈라 놓으면 요약의 '결석 N'이 조용히 줄어든다.
 */
export type SeatMark = AttendanceMark | "unmarked" | "waiting";

export const SEAT_MARK_LABEL: Record<SeatMark, string> = {
  ...STATUS_TEXT,
  unmarked: "미출결",
  waiting: "대기",
};

/**
 * 같은 5색의 **영어 라벨** — 강사뷰 영어 화면(원장 2026-09-04 *"강사가 접근 가능한 모든 메뉴를 전환"*).
 *
 * 🔴 **한글 맵 바로 옆에 둔다** — 두 파일로 나누면 상태가 하나 늘 때 한쪽만 채워지고, 빠진 키는
 *    raw enum(`waiting`)이 화면에 그대로 샌다(ECS `attendance-label.ts`와 같은 규약).
 * ⚠️ 이 표는 **표시 전용**이다 — 저장값은 `attendance_status` enum 그대로다.
 */
export const SEAT_MARK_LABEL_EN: Record<SeatMark, string> = {
  ...STATUS_TEXT_EN,
  unmarked: "Not marked",
  waiting: "Waiting",
};

/** 화면에 적을 표시 상태. 인자를 안 주면 한국어(기존 호출부는 한 글자도 안 바뀐다). */
export function seatMarkLabelOf(mark: SeatMark, lang: "ko" | "en" = "ko"): string {
  return lang === "en" ? SEAT_MARK_LABEL_EN[mark] : SEAT_MARK_LABEL[mark];
}

/**
 * 기록이 있는 칸은 **출석부 `STATUS_TONE` 그대로**(민트·빨강·주황·파랑·보라) — 한 벌을 펴서 쓴다.
 * 시작 전(대기)은 민트를 쓰지 않는다 — classday는 출석과 같은 계열이라 전원 출석으로 읽힌다.
 * ⚠️ 칸 버튼에 `bg-card`를 덧씌우지 말 것 — 동형 유틸은 CSS 순서라 출석 배경이 진다.
 */
export const SEAT_MARK_TONE: Record<SeatMark, string> = {
  ...STATUS_TONE,
  unmarked: `${DAY_TONE.outside} text-att-absent-ink`,
  waiting: "border-line bg-card text-text-dim border",
};

/**
 * 알약 **밖**에 적는 글자 색(좌석표 칸의 체크 시각 줄) — 카드 바탕 위에서 읽히는 상태 잉크.
 *
 * 원장(2026-08-21): *"글자는 검정이 아니어야되고 가독성이 좋은 색상으로. 출결 색상에 따라 글자 색상도
 * 바뀌거나…"* → 배경이 없는 자리라 `SEAT_MARK_TONE`(배경+잉크)을 그대로 쓸 수 없다. **잉크만** 뽑되
 * 같은 색 계열을 유지해 시각 줄만 훑어도 무슨 표시인지 읽히게 한다.
 * ⚠️ 화면 파일에 이 맵을 복사하지 말 것 — 상태 색은 이 모듈이 단일 소스다(팔레트 v4 캐논).
 */
export const SEAT_MARK_INK: Record<SeatMark, string> = {
  present: "text-att-present-ink",
  absent: "text-att-absent-ink",
  excused: "text-att-absent-ink",
  late: "text-att-late-ink",
  early_leave: "text-att-leave-ink",
  makeup: "text-att-makeup-ink",
  // 기록이 없는 칸엔 시각 줄 자체가 안 그려진다 — 맵을 닫아 두기 위한 값.
  unmarked: "text-text-dim",
  waiting: "text-text-dim",
};

/** 마우스오버 — 결석이면 사유 메모를 둘째 줄에. */
export function seatHoverTitle(input: {
  studentName: string;
  schoolGrade?: string | null;
  mark: SeatMark;
  note?: string | null;
  /**
   * 체크 시각 **전체 일시**(`attendanceCheckMark(...).full` = `2026-08-21 15:08`).
   * 칸에는 연도가 안 들어가니 여기서 마감한다 — 없으면(미출결) 아무것도 안 붙인다.
   */
  checkedAt?: string | null;
  /** 담임 아닌 입력자 이름(`seatRecorderName`) — 좁은 칸에서 잘렸어도 여기선 온전히 읽힌다. */
  recordedByName?: string | null;
  /**
   * 화면 언어 — 안 주면 한국어(자리 출석부·데스크 화면은 그대로다).
   * ⚠️ 학생 이름은 **호출부가 정한 글자를 그대로** 받는다(영어 이름 전환은 `studentDisplayName`
   *    단일 소스라 여기서 다시 고르지 않는다).
   */
  lang?: "ko" | "en";
}): string {
  const lang = input.lang ?? "ko";
  const bits = [input.studentName];
  if (input.schoolGrade) bits.push(input.schoolGrade);
  bits.push(seatMarkLabelOf(input.mark, lang));
  if (input.checkedAt) {
    const checked =
      lang === "en"
        ? input.recordedByName
          ? `${input.checkedAt} checked by ${input.recordedByName}`
          : `${input.checkedAt} checked`
        : input.recordedByName
          ? `${input.checkedAt} ${input.recordedByName} 체크`
          : `${input.checkedAt} 체크`;
    bits.push(checked);
  }
  const head = bits.join(" · ");
  const note = input.note?.trim();
  if (input.mark === "absent" && note) return `${head}\n${note}`;
  return head;
}

/**
 * 그 칸의 표시 상태 — **기록이 있으면 그 값 그대로**, 없으면 국면으로 대기/미출결.
 *
 * 🔴 접지 말 것(원장 2026-09-08 *"전부 통일된 뷰"*). 종전엔 `makeup → present`·`early_leave → late`로
 *    접어서, 같은 기록을 출석부는 `보강`·`조퇴`라 부르는데 이 화면만 `출석`·`지각`이라 했다.
 * ⚠️ 유일한 접기 = **`excused`(공결) → `absent`**. 출석부 정본(`STATUS_TEXT`/`STATUS_VAR`)도 공결을
 *    결석과 **같은 라벨·같은 색**으로 그리므로 화면은 어차피 같고, 여기서 갈라 놓으면 요약의
 *    '결석 N'(`mark === "absent"`로 센다)이 조용히 줄어든다.
 */
/** 저장값 그대로 쓰는 표시 상태(공결은 아래에서 결석으로 접는다). */
const RECORDED_MARKS: ReadonlySet<string> = new Set(["present", "absent", "late", "early_leave", "makeup"]);

export function seatMarkOf(status: string | null, phase: SlotPhase): SeatMark {
  if (status === "excused") return "absent";
  if (status != null && RECORDED_MARKS.has(status)) return status as SeatMark;
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
