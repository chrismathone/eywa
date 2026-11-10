/**
 * **신규생 관리 체크리스트** — 항목 정의·기한·상태 판정(순수·Vitest).
 *
 * 원장 2026-09-09: *"신입 등록부터 3개월까지 7일, 30일, 60일, 90일 까지 관리하는거야. 각종 지표를 바로
 * 확인하게해서 신입생이 잘 관리되고 있는가 체크"* + 체크리스트 6(+1)항목.
 *
 * 🔴 **기준일이 둘이다** — 창(7·30·60·90일)은 **등록일**(`students.enrolled_at`)에서 세지만, 사전 콜·첫 수업
 *    안내·첫 수업 후 콜은 **첫 수업일**에 매달아야 한다. 실측 2026-09-09: 등록일과 첫 수업일 간격이 **0~20일**
 *    이라(김채현 18일·류태경 20일) 등록일+7로 "첫 수업 후 콜"을 재촉하면 **수업도 하기 전에 지연**이 된다.
 * 🔴 **첫 수업일을 모르면 기한도 없다**(`pending`) — 모르는 것을 지연으로 세지 않는다. 반 배정 전 학생이 그렇다.
 * ⚠️ 2개월 콜은 원장이 *"필요시"*라 적었다 → `optional: true`. **지연 집계·완료율 분모에서 빠진다**
 *    (필수처럼 세면 매달 전원이 빨갛게 된다). 체크는 그대로 할 수 있다.
 */

import { diffDays } from "@/lib/date-kst";

export const ONBOARDING_ANCHORS = ["enrolled", "firstClass"] as const;
export type OnboardingAnchor = (typeof ONBOARDING_ANCHORS)[number];

export type OnboardingItemDef = {
  key: string;
  label: string;
  /** 표 열 머리에 쓰는 짧은 이름(열 폭이 좁다). */
  shortLabel: string;
  anchor: OnboardingAnchor;
  /** 기준일에서 며칠 뒤가 기한인가(음수 = 기준일 전). */
  offsetDays: number;
  /** '필요시' 항목 — 지연·완료율에서 뺀다. */
  optional?: boolean;
};

/** 🔴 `key`는 DB에 저장되는 식별자다 — 라벨을 바꿔도 key는 바꾸지 말 것(기록이 끊긴다). */
export const ONBOARDING_ITEMS: readonly OnboardingItemDef[] = [
  { key: "pre_call", label: "수업 전 사전 콜", shortLabel: "사전 콜", anchor: "firstClass", offsetDays: -1 },
  {
    key: "first_class_guide",
    label: "첫 수업 교재·과제·교실 안내",
    shortLabel: "첫 수업 안내",
    anchor: "firstClass",
    offsetDays: 0,
  },
  { key: "ojt", label: "신입생 OJT 실시", shortLabel: "OJT", anchor: "enrolled", offsetDays: 7 },
  {
    key: "after_first_call",
    label: "첫 수업 후 상담 콜",
    shortLabel: "첫 수업 후 콜",
    anchor: "firstClass",
    offsetDays: 7,
  },
  { key: "month1_call", label: "1개월 만족도 콜", shortLabel: "1개월 콜", anchor: "enrolled", offsetDays: 30 },
  {
    key: "month2_call",
    label: "2개월 만족도 콜(필요시)",
    shortLabel: "2개월 콜",
    anchor: "enrolled",
    offsetDays: 60,
    optional: true,
  },
  { key: "month3_call", label: "3개월 만족도 콜", shortLabel: "3개월 콜", anchor: "enrolled", offsetDays: 90 },
];

export const ONBOARDING_ITEM_KEYS: readonly string[] = ONBOARDING_ITEMS.map((item) => item.key);

/** 며칠 뒤/전 날짜(YYYY-MM-DD, KST 달력일). */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 달력일 차(to − from) — 공용 `diffDays`(lib/date-kst) 그대로. 이 이름으로 쓰는 곳이 많아 별칭으로 남긴다. */
export function daysBetween(from: string, to: string): number {
  return diffDays(from, to);
}

export type OnboardingItemStatus =
  /** 완료 */
  | "done"
  /** 기한이 지났는데 미완료 */
  | "overdue"
  /** 오늘까지 또는 사흘 안 */
  | "due"
  /** 아직 여유 */
  | "upcoming"
  /** 기한을 모른다(첫 수업일 미정) — 지연이 아니다 */
  | "pending"
  /** 이 기능이 생기기 **전에** 기한이 지난 항목 — 지연이 아니다(아래 `NEWCOMER_BASELINE_DATE`) */
  | "waived";

/**
 * 이 기능이 문을 연 날 — **이 날짜보다 앞선 기한은 지연으로 세지 않는다.**
 *
 * 원장 2026-09-09: *"오늘 생긴 기능이므로 지나간 미완료 건에 대해서는 됐고, 지금부터 보여지는 31건에
 * 대해서만 진행하도록."* 체크리스트가 오늘 생겼는데 등록은 90일 전부터 있어서, 그냥 계산하면 **134건이
 * 전부 빨강**이 된다 — 아무도 기록할 수 없었던 기간의 미기록을 "놓쳤다"고 부르는 것은 거짓이고, 그 빨강이
 * 진짜 지연(오늘부터 쌓일 것)을 묻는다.
 *
 * 🔴 **값을 앞당기지 말 것** — 앞당기면 그 순간 옛 기한이 되살아나 화면이 다시 빨개진다.
 * ⚠️ 완료 체크는 기준일과 무관하다 — 옛 항목도 실제로 했다면 체크할 수 있고 완료로 남는다.
 */
export const NEWCOMER_BASELINE_DATE = "2026-09-09";

/** '임박'으로 볼 남은 날수 — 후속조치 카드(오늘·임박)와 같은 창. */
export const DUE_SOON_DAYS = 3;

export type NewcomerAnchors = {
  /** 등록일 `YYYY-MM-DD`. */
  enrolledOn: string;
  /** 첫 수업일 — 모르면 null. */
  firstClassOn: string | null;
};

/** 그 항목의 기한. 기준일을 모르면 null. */
export function dueDateOf(item: OnboardingItemDef, anchors: NewcomerAnchors): string | null {
  const base = item.anchor === "enrolled" ? anchors.enrolledOn : anchors.firstClassOn;
  if (!base) return null;
  return shiftDate(base, item.offsetDays);
}

export function statusOf(
  item: OnboardingItemDef,
  anchors: NewcomerAnchors,
  doneOn: string | null | undefined,
  today: string,
  /** 이 날짜보다 앞선 기한은 지연이 아니다(기능 시작일). 테스트가 다른 값을 넣을 수 있게 인자로 둔다. */
  baseline: string = NEWCOMER_BASELINE_DATE,
): OnboardingItemStatus {
  // 완료는 기준일과 무관하다 — 옛 항목도 실제로 했다면 체크할 수 있고 완료로 남는다.
  if (doneOn) return "done";
  const due = dueDateOf(item, anchors);
  if (!due) return "pending";
  // 🔴 기능이 생기기 **전에** 지난 기한은 "놓친 것"이 아니다 — 기록할 방법 자체가 없었다.
  if (due < baseline) return "waived";
  if (due < today) return "overdue";
  return daysBetween(today, due) <= DUE_SOON_DAYS ? "due" : "upcoming";
}

/** `upcoming`·`due` 항목이 며칠 남았나 — 화면의 `D-n` 표기용. 기한이 없으면 null. */
export function daysLeftOf(
  item: OnboardingItemDef,
  anchors: NewcomerAnchors,
  today: string,
): number | null {
  const due = dueDateOf(item, anchors);
  return due ? daysBetween(today, due) : null;
}

/** 등록 경과일로 나눈 관리 구간 — 원장이 말한 7·30·60·90일. */
export const NEWCOMER_BUCKETS = ["d7", "d30", "d60", "d90", "over"] as const;
export type NewcomerBucket = (typeof NEWCOMER_BUCKETS)[number];

export const BUCKET_LABEL: Readonly<Record<NewcomerBucket, string>> = {
  d7: "7일",
  d30: "30일",
  d60: "60일",
  d90: "90일",
  over: "90일 초과",
};

/**
 * 관리 대상 창 — 등록 후 이 일수까지가 '신규생'이다(원장이 말한 3개월).
 * 🔴 목록(탭)과 운영실 신호가 **같은 상수·같은 식**을 써야 한다 — 하루가 어긋나면 딱 그 경계에 있는 학생이
 *    한쪽에만 뜬다(운영실은 "지연 3명"인데 탭엔 2명).
 */
export const NEWCOMER_WINDOW_DAYS = 90;

/** 관리 대상의 가장 이른 등록일(포함) — `elapsed <= NEWCOMER_WINDOW_DAYS`와 같은 경계. */
export function newcomerWindowStart(today: string): string {
  return shiftDate(today, -NEWCOMER_WINDOW_DAYS);
}

export function bucketOf(enrolledOn: string, today: string): NewcomerBucket {
  const elapsed = daysBetween(enrolledOn, today);
  if (elapsed <= 7) return "d7";
  if (elapsed <= 30) return "d30";
  if (elapsed <= 60) return "d60";
  if (elapsed <= 90) return "d90";
  return "over";
}

export type NewcomerChecks = Readonly<Record<string, string | null | undefined>>;

export type NewcomerProgress = {
  /** 지금까지 기한이 온 필수 항목 수(분모) — 아직 안 온 항목은 안 센다. */
  dueTotal: number;
  /** 그중 완료 */
  doneCount: number;
  /** 기한이 지난 미완료(필수만) */
  overdue: number;
  /** 오늘·사흘 안(필수만) */
  dueSoon: number;
  /** 0~100. 분모가 0이면 100(아직 할 일이 없다 = 정상). */
  rate: number;
};

/**
 * 한 학생의 진행도.
 * 🔴 분모는 **지금까지 기한이 온 필수 항목**이다 — 7항목 전부로 나누면 등록 첫날 학생이 14%로 보여
 * "관리 안 됨"처럼 읽힌다(아직 할 때가 안 됐을 뿐).
 */
export function progressOf(
  anchors: NewcomerAnchors,
  checks: NewcomerChecks,
  today: string,
  items: readonly OnboardingItemDef[] = ONBOARDING_ITEMS,
  baseline: string = NEWCOMER_BASELINE_DATE,
): NewcomerProgress {
  let dueTotal = 0;
  let doneCount = 0;
  let overdue = 0;
  let dueSoon = 0;
  for (const item of items) {
    const status = statusOf(item, anchors, checks[item.key], today, baseline);
    if (item.optional) continue;
    if (status === "done") {
      // 기한 전에 미리 한 것도 분모·분자에 함께 넣는다(비율이 100을 넘지 않게).
      dueTotal += 1;
      doneCount += 1;
      continue;
    }
    if (status === "overdue") {
      dueTotal += 1;
      overdue += 1;
      continue;
    }
    if (status === "due") {
      dueTotal += 1;
      dueSoon += 1;
    }
    // upcoming·pending·waived는 분모 밖 — 아직 할 때가 아니거나, 기한을 모르거나,
    // 기능이 생기기 전이라 **기록할 방법 자체가 없었던** 항목이다.
  }
  return {
    dueTotal,
    doneCount,
    overdue,
    dueSoon,
    rate: dueTotal === 0 ? 100 : Math.round((doneCount / dueTotal) * 100),
  };
}
