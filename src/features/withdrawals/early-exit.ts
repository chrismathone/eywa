/**
 * **등록 후 조기 퇴원** — 등록일부터 퇴원일까지 며칠 만에 그만뒀나(순수 · Vitest).
 *
 * 원장 2026-10-15: *"등록일 기준으로 3개월 이내에 퇴원한 학생들을 추적하려고 해. 1개월, 2개월, 3개월을 기간으로 두고
 * 추적하면 좋을듯"* + *"대시보드에서도 볼 수 있게 위젯으로도"*. 퇴원관리 '등록 후' 필터·띠와 운영실 카드가 이 한 벌을 쓴다.
 *
 * 🔑 등록일 = `students.enrolled_at` — 신규생 관리(등록 후 90일 체크리스트)와 같은 칸이다.
 * 🔑 1·2·3개월 = **30·60·90일**(양끝 포함) — 신규생 관리의 1개월·3개월 콜과 같은 날 수. 달력 달로 세면 두 화면의
 *    '3개월'이 하루 이틀 갈린다.
 * 🔑 기간은 **누적**이다 — '2개월 이내'에 '1개월 이내'가 들어 있다(필터 '이내'의 뜻 그대로).
 * 🔴 퇴원만 센다 — 수강종료(재원 중 한 과목을 끊음)는 학생 등록일과 그 과목 시작일이 달라 같은 잣대로 못 잰다.
 * 🔴 판정 못 하는 퇴원은 세지 않는다(`null`): 등록일·퇴원일이 비었거나 모양이 틀림 · 퇴원일이 등록일보다 앞섬(실측 침산 5건 —
 *    다시 등록하며 등록일이 바뀐 기록) · 시스템 정리(퇴원일 미상, 호출부가 넘기지 않는다).
 */

export type EarlyKey = "1m" | "2m" | "3m";

export type EarlySpan = { key: EarlyKey; label: string; days: number };

/** 고르는 순서 = 화면 순서. */
export const EARLY_SPANS: readonly EarlySpan[] = [
  { key: "1m", label: "1개월 이내", days: 30 },
  { key: "2m", label: "2개월 이내", days: 60 },
  { key: "3m", label: "3개월 이내", days: 90 },
];

/** 가장 긴 기간(90일) — 운영실 카드가 이 안의 퇴원만 명단에 세운다. */
export const EARLY_MAX_DAYS = 90;

export function parseEarly(v: string | null | undefined): EarlyKey | null {
  return v === "1m" || v === "2m" || v === "3m" ? v : null;
}

export function earlySpan(key: EarlyKey): EarlySpan {
  return EARLY_SPANS.find((s) => s.key === key)!;
}

const ymd = (v: string | null | undefined): string | null => {
  const s = v ? v.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : null;
};

/** 등록일 → 퇴원일 일수(같은 날 = 0). 판정할 수 없으면 null — 위 🔴 참조. */
export function tenureDays(enrolledAt: string | null | undefined, withdrawnAt: string | null | undefined): number | null {
  const from = ymd(enrolledAt);
  const to = ymd(withdrawnAt);
  if (!from || !to) return null;
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  return days >= 0 ? days : null;
}

export function isEarlyWithin(days: number | null, key: EarlyKey): boolean {
  return days !== null && days <= earlySpan(key).days;
}

/**
 * 판정 못 한 퇴원의 안내 — 퇴원관리 띠와 운영실 카드가 같은 말을 쓴다. 등록일이 퇴원일보다 늦은 기록은 등록일을 '모르는' 게
 * 아니라 그 등록일로 판정할 수 없는 것이라 이렇게 적는다.
 */
export function unjudgedText(count: number): string {
  return count > 0 ? `등록일로 판정할 수 없는 ${count}명 제외` : "";
}

/** 기간마다 몇 명(누적) — 퇴원관리 띠와 운영실 카드·요약이 같은 함수로 센다. */
export function earlyCounts(rows: readonly { days: number | null }[]): Record<EarlyKey, number> {
  const out: Record<EarlyKey, number> = { "1m": 0, "2m": 0, "3m": 0 };
  for (const r of rows) for (const s of EARLY_SPANS) if (isEarlyWithin(r.days, s.key)) out[s.key] += 1;
  return out;
}
