/**
 * 당일 출결 신호 판정 — 순수 함수(Vitest).
 *
 * 배경(2026-08-14 원장 지시): *"수업보고서로 출석체크를 하니 당일 바로 처리가 안 되고, 다음날 발송하는
 * 강사도 있다. 당일 선생님별 출석부가 있어야겠고, 출석하지 않은 학생이 데스크에 연동돼 학부모·학생
 * 확인이 바로 이어지게."*
 *
 * 🔴 실측이 이 파일의 존재 이유다(프로덕션 DB, 2026-08-14):
 *   · `present` 2,615건 중 **1,971건(75%)이 수업 다음날 이후**에 기록됐다. 당일 기록은 25%뿐.
 *   · 수업이 열렸는데 출결이 **한 행도 없는** 비율 = 최근 28일 901 반×날짜 중 **557건(61.8%)**
 *     (영어 91.6% / 수학 30.2%). 하루 200명 넘는 학생의 등원 여부가 시스템에 남지 않는다.
 *   · 그래서 "안 온 학생"을 데스크가 알 방법이 지금은 없다.
 *
 * 🔑 이 파일이 지키는 핵심 구분 — **모름(unmarked) ≠ 결석(absent)**.
 *   데스크가 "안 왔다"고 전화했는데 실은 교실에 앉아 있었다면 그 한 통이 학부모 신뢰를 깎는다.
 *   그래서 신호를 셋으로 나눈다(강도순):
 *     ① `absent`         강사가 결석으로 찍음 = **사실**. 즉시 연락 대상.
 *     ② `unmarked`       그 반·그 교시는 이미 찍히는 중인데(기록 ≥1) **이 학생만 빈 칸** = 강한 의심.
 *     ③ `class_unmarked` 그 반·그 교시가 통째로 빈 칸 = **강사 미체크**. 학생 개인을 의심할 근거가 없다.
 *   ③을 학생 단위로 쏟으면 영어 반(91.6% 미체크)만으로 데스크에 수백 건이 쌓여 기능이 죽는다 →
 *   ③은 반 단위 카드 하나로 접고, 연락이 아니라 **강사에게 확인 요청**이 정답이다(queue.ts).
 */

/**
 * 유예(분) — 교시 시작 후 이만큼 지나야 빈 칸이 **미출결**이다(원장 2026-08-14: 10분).
 * 그 전에는 '대기'. 🔴 입력 잠금이 아니라 표시·전달 기준 — 강사는 지나도 계속 찍는다.
 */
export const ATTENDANCE_GRACE_MIN = 10;
/** @deprecated 이름만 `ATTENDANCE_GRACE_MIN`으로 통일. 값은 같다. */
export const LIVE_GRACE_MIN = ATTENDANCE_GRACE_MIN;

export type SlotPhase =
  /** 아직 시작 전 — 아무 신호도 만들지 않는다. */
  | "before"
  /** 시작했지만 유예 안 — 화면엔 보이되 데스크 큐엔 안 올린다. */
  | "grace"
  /** 유예 경과, 수업 진행 중 — 큐 대상. */
  | "due"
  /** 수업 종료 — 큐 대상이면서 강도가 한 단계 높다(끝났는데도 모른다). */
  | "ended";

/**
 * 교시의 현재 국면. 분 단위(KST 자정 기준)로만 계산한다 — 날짜가 다르면 호출부가 부르지 않는다.
 * `endMin`이 없으면(종료시각 미상) 종료 판정을 하지 않는다(끝난 척하지 않는다).
 */
export function slotPhase(
  nowMin: number,
  startMin: number,
  endMin: number | null,
  graceMin: number = ATTENDANCE_GRACE_MIN,
): SlotPhase {
  if (nowMin < startMin) return "before";
  if (endMin != null && nowMin >= endMin) return "ended";
  if (nowMin < startMin + graceMin) return "grace";
  return "due";
}

export type LiveSignal = "absent" | "unmarked" | "class_unmarked";

/** 신호 강도 — 큐 정렬과 "이건 사실 / 이건 의심"의 표시 구분에 함께 쓴다. */
export const SIGNAL_RANK: Record<LiveSignal, number> = {
  absent: 2,
  unmarked: 1,
  class_unmarked: 0,
};

/**
 * 학생 한 명 × 한 교시의 신호.
 *
 * @param status      그 (학생·반·날짜·교시)의 **유효** 출결 상태(없으면 null)
 * @param classHasAny 그 (반·날짜·교시)에 출결 기록이 하나라도 있는가 — ②와 ③을 가르는 유일한 근거
 *
 * 🔑 **강사가 이미 답한 칸은 전부 신호가 아니다** — 데스크가 확인할 게 없다:
 *    · `present`·`makeup` = 왔다  · `late` = 늦게 **왔다**  · `early_leave` = 왔다가 갔다(강사가 보냈다)
 *    · `excused` = 사유를 이미 안다
 *    지각을 큐에 올리면 "이미 교실에 앉아 있는 아이"의 집에 전화가 간다 — 이 기능이 가장 하지 말아야 할 일.
 */
export function classifySignal(status: string | null, classHasAny: boolean): LiveSignal | null {
  if (status === "absent") return "absent";
  if (status != null) return null; // present/late/excused/makeup/early_leave = 강사가 답한 칸
  return classHasAny ? "unmarked" : "class_unmarked";
}

/**
 * 데스크 큐에 올릴 신호인가 — 국면과 신호를 함께 본다.
 *
 * · `absent`는 **유예를 기다리지 않는다**. 강사가 결석을 찍은 순간이 가장 확실한 신호이고, 셔틀·하원
 *   시간을 감안하면 유예를 더 흘려보낼 이유가 없다(단 시작 전에 미리 찍어둔 건 제외 — 아래 before).
 * · 나머지는 유예 경과(`due`) 이후부터. `grace`에서 올리면 매일 20분마다 "지각생 전원"이 큐에 뜬다.
 * · 시작 전(`before`)은 무조건 제외 — 아직 오지 않은 게 정상이다.
 */
export function shouldQueue(signal: LiveSignal, phase: SlotPhase): boolean {
  if (phase === "before") return false;
  if (signal === "absent") return true;
  return phase === "due" || phase === "ended";
}

/**
 * 화면에 쓸 한글 라벨 — raw enum을 UI에 내보내지 않는다(전역 규칙).
 * ⚠️ `unmarked`를 "결석"이라 부르면 안 된다. 우리가 아는 건 "확인 안 됨"까지다.
 */
export const SIGNAL_LABEL: Record<LiveSignal, string> = {
  absent: "결석",
  unmarked: "미확인",
  class_unmarked: "강사 미체크",
};

/** 신호별 한 줄 설명 — 데스크가 전화 전에 "얼마나 확실한지"를 알고 걸게 한다. */
export const SIGNAL_HINT: Record<LiveSignal, string> = {
  absent: "강사가 결석으로 입력했습니다",
  unmarked: "같은 교시 다른 학생은 입력됐는데 이 학생만 비어 있습니다",
  class_unmarked: "이 교시 출결이 아직 입력되지 않았습니다 — 학생이 아니라 강사 확인이 먼저입니다",
};

/**
 * 그 교시 칸의 **유효 상태** — 교시별 기록과 "그날 전체" 기록을 겹쳐 읽는다.
 *
 * 두 세대가 공존하기 때문이다(0196a): ECS 주간 시트는 교시별로 저장하고(`slot_start` 있음),
 * 출석부·원스크린·키오스크는 그날 전체로 저장한다(`slot_start` null). 한쪽만 보면
 * "원스크린에서 찍었는데 당일 출석부는 여전히 비어 있다"가 되어 데스크에 거짓 미확인이 뜬다.
 *
 * 우선순위: **그 교시 기록 > 그날 전체 기록**. 교시 지정이 더 구체적인 사실이라 먼저다.
 */
export function resolveSlotStatus(
  bySlot: string | null | undefined,
  byDay: string | null | undefined,
): string | null {
  return bySlot ?? byDay ?? null;
}

/** 분("HH:MM[:SS]" → 자정 기준 분). 형식이 아니면 null. */
export function hhmmToMin(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "HH:MM" 표시용(초 절단). 형식이 아니면 원문 그대로 — 표시에서 값을 잃지 않는다. */
export function hhmm(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = /^(\d{2}:\d{2})/.exec(raw);
  return m ? m[1] : raw;
}
