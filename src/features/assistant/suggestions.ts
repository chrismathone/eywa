/**
 * 학원 비서 첫 화면 추천 질문 — 순수 계산(서버·화면 공용 · Vitest).
 *
 * 원장 2026-11-06 *"처음 추천 대화도 최근 학원 추세를 보고 스마트하게 질문이 출력되게"* ·
 * *"이전과 변경된 새로운 질문이 배치될때마다 NEW 라벨 붙여줘"* · *"새 질문은 매일 한번 업데이트 필요할때마다 업데이트해주고"*.
 *
 * - 서버(`server/suggestion-signals.ts`)가 이 지점의 추세 신호를 싼 집계로 세고 → `buildSuggestions`가 심한 순으로 질문 6개를 만든다
 *   (모자라면 고정 문장 `ASSISTANT_SUGGESTIONS`로 채운다 — 신호가 이미 다룬 주제의 고정 문장은 뺀다).
 * - 질문 글에는 원생 이름·연락처를 넣지 않는다(반 이름·건수까지).
 * - 화면은 사람·지점(`scope`)과 한국 날짜 하나로 묶어 브라우저에 둔다 — 하루 한 번 받고, '새로 고침'으로 다시 받는다.
 *   🔴 NEW = 직전 묶음에 없던 **주제**(`key` — 결석 · '○○반 출석률' · 미납 …). 숫자만 바뀐 질문은 NEW가 아니다(그러면 매일 거의 다 NEW였다).
 *   NEW는 묶음이 바뀐 그날에만 보이고, 고정 문장에는 붙지 않는다(적대 리뷰 2026-11-09). 본 것은 브라우저에 둔다(기기를 바꾸면 처음부터 — 편의 표시라 계정에 두지 않았다).
 */
import { ASSISTANT_SUGGESTIONS } from "./protocol";

export type AssistantSuggestion = {
  /** 누르면 그대로 묻는 질문. */
  text: string;
  /** 왜 이 질문인지 — 짧은 숫자 근거(없으면 고정 문장). */
  reason?: string;
  /** 주제 열쇠(NEW 판정) — 신호 질문만. 고정 문장은 `static:<글>`. */
  key?: string;
};

/** `GET /api/assistant/suggestions` 응답. `items`가 없으면 "화면이 가진 묶음(have)이 오늘 것 그대로"라는 뜻. */
export type SuggestionsResponse = {
  scope: string;
  /** 한국 날짜(YYYY-MM-DD) — 이 묶음을 만든 날. */
  day: string;
  items?: AssistantSuggestion[];
  /** 신호를 하나도 세지 못해 고정 문장만 돌려줬다(화면은 '본 묶음'으로 저장하지 않는다). */
  fallback?: boolean;
  /** 신호 일부를 세지 못했다 — 보여 주되 '오늘 묶음'으로 저장하지 않는다(다음에 열 때 다시 센다). */
  partial?: boolean;
};

/** 서버가 센 추세 신호 — 세지 못한 신호는 비운다. */
export type SuggestionSignals = {
  /** 최근 2주 결석(유효 출결 · 재원생) · 그 전 2주 · 최근 2주 3번 이상 결석한 원생 수(주 2~3번 다니니 2주 3번이면 눈에 띈다). */
  absence?: { recent: number; before: number; students: number };
  /** 출석률이 가장 많이 떨어진 운영 중인 반(최근 4주 vs 그 전 4주 · 양쪽 20건 이상). */
  classDrop?: { className: string; n0: number; p0: number; n1: number; p1: number };
  /**
   * 실제 퇴원 — 퇴원일이 이번 달(1일~오늘)인 원생 · 그 앞 6개 달 · 퇴원 예정. 🔴 운영실 카드는 퇴원월(수강료를 낸 마지막 달) 기준이라
   * 숫자가 다를 수 있다 — 질문의 실마리일 뿐 정답 수는 비서가 다시 센다(재리뷰 2026-11-09).
   */
  withdrawals?: { thisMonth: number; prev6: number; scheduled: number };
  /** 미납·부분납 청구서 — 건수 · 미수 합(원) · 2달 넘은 것. */
  unpaid?: { count: number; won: number; old: number };
  /** 재원생 상담 — 석 달 넘게 상담 기록 없는 재원생 · 기한 지난 후속조치(최근 60일 기한). */
  consult?: { noRecent: number; overdue: number };
  /** 신규 상담(상담 뒤 일주일 지난 최근 30일 몫) · 그중 등록. */
  conversion?: { consulted: number; enrolled: number };
  /** 3주 안에 시작하는 내신(적어 둔 학교만) — 학교 수 · 가장 이른 날. */
  exams?: { schools: number; earliest: string | null };
};

export const SUGGESTION_COUNT = 6;

/** 고정 문장이 다루는 주제 — 같은 주제의 신호 질문이 있으면 그 고정 문장은 뺀다. */
type Topic = "withdrawals" | "unpaid" | "absence" | "reports" | "composition" | "expenses";
const STATIC_TOPIC: Readonly<Record<string, Topic>> = {
  "이번 달 신규·퇴원 추이를 지난 6개월과 비교해 줘": "withdrawals",
  "미납 현황을 반별로 정리해 줘": "unpaid",
  "최근 2주 결석이 늘어난 원생은?": "absence",
  "강사별 이번 달 수업보고서 작성률": "reports",
  "과목·학년별 재원생 구성": "composition",
  "이번 달 지출을 분류별로 보여 줘": "expenses",
};

export const FALLBACK_SUGGESTIONS: readonly AssistantSuggestion[] = ASSISTANT_SUGGESTIONS.map((text) => ({ text, key: `static:${text}` }));

type Scored = AssistantSuggestion & { score: number; topic?: Topic };

const n = (v: number) => v.toLocaleString("ko-KR");
const pct = (num: number, den: number) => Math.round((num / den) * 100);
/** 금액 — 만 원 단위(1만 원 아래는 원 그대로). */
export function wonLabel(won: number): string {
  if (won < 10_000) return `${n(Math.round(won))}원`;
  return `${n(Math.round(won / 10_000))}만 원`;
}
/** YYYY-MM-DD → 'M월 D일'. */
function md(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}월 ${d}일`;
}
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 신호 → 점수 매긴 질문들(심하지 않은 신호는 내지 않는다). */
export function scoreSignals(s: SuggestionSignals, today: string): Scored[] {
  const out: Scored[] = [];
  const a = s.absence;
  if (a && (a.students >= 3 || (a.students >= 1 && a.recent > a.before))) {
    out.push({
      key: "absence",
      topic: "absence",
      score: 40 + Math.min(40, a.students * 4) + (a.recent > a.before ? 15 : 0),
      text: `최근 2주 결석이 3번 이상인 원생 ${n(a.students)}명 — 누구이고 왜 그런지 분석해 줘`,
      reason: `최근 2주 결석 ${n(a.recent)}번 · 그 전 2주 ${n(a.before)}번(빠진 수업 단위)`,
    });
  }
  const c = s.classDrop;
  if (c && c.n0 > 0 && c.n1 > 0) {
    const before = pct(c.p0, c.n0);
    const after = pct(c.p1, c.n1);
    const drop = before - after;
    if (drop >= 5) {
      out.push({
        key: `classDrop:${c.className}`,
        score: 50 + Math.min(40, Math.round(drop * 3)),
        text: `'${c.className}' 출석률이 ${before}%에서 ${after}%로 떨어졌어 — 원인을 분석해 줘`,
        reason: `최근 4주 출결 ${n(c.n1)}건 · 그 전 4주 ${n(c.n0)}건 기준`,
      });
    }
  }
  const w = s.withdrawals;
  if (w && w.thisMonth > 0) {
    const avg = Math.round((w.prev6 / 6) * 10) / 10;
    const rising = w.thisMonth >= 2 && w.thisMonth > avg * 1.2;
    out.push({
      key: "withdrawals",
      topic: "withdrawals",
      score: rising ? 45 + Math.min(40, Math.round((w.thisMonth - avg) * 10)) : 20,
      text: `이번 달 퇴원 ${n(w.thisMonth)}명 — 지난 6개월 평균(월 ${avg}명)과 비교해 사유와 공통점을 분석해 줘`,
      reason: `${w.scheduled > 0 ? `퇴원 예정 ${n(w.scheduled)}명 더 있음 · ` : ""}퇴원일이 이번 달 1일~오늘 · 실제 퇴원만`,
    });
  }
  const u = s.unpaid;
  if (u && u.count > 0) {
    out.push({
      key: "unpaid",
      topic: "unpaid",
      score: 35 + Math.min(35, u.count) + (u.old > 0 ? 15 : 0),
      text: `미납 ${n(u.count)}건(합계 ${wonLabel(u.won)}) — 반별·청구 달별로 정리하고 오래된 것부터 알려 줘`,
      reason: u.old > 0 ? `2달 넘은 미납 ${n(u.old)}건` : "미납·부분납 청구서 기준",
    });
  }
  const k = s.consult;
  if (k && k.overdue > 0) {
    out.push({
      key: "consult.overdue",
      score: 40 + Math.min(30, k.overdue * 3),
      text: `기한이 지난 상담 후속조치 ${n(k.overdue)}건 — 누구 것이고 무엇이 남았는지 정리해 줘`,
      reason: "최근 60일 안의 후속조치 기한 기준",
    });
  }
  if (k && k.noRecent >= 5) {
    out.push({
      key: "consult.noRecent",
      score: 30 + Math.min(30, Math.round(k.noRecent / 2)),
      text: `석 달 넘게 상담 기록이 없는 재원생 ${n(k.noRecent)}명 — 누구부터 상담하면 좋을지 정리해 줘`,
      reason: "지금 반 명단의 재원생 · 등록한 지 석 달 안 된 원생 제외",
    });
  }
  const v = s.conversion;
  if (v && v.consulted >= 5) {
    const rate = Math.round((v.enrolled / v.consulted) * 100);
    out.push({
      key: "conversion",
      score: 30 + (rate < 40 ? 20 : 0),
      text: `최근 한 달 신규 상담 ${n(v.consulted)}건 중 등록 ${n(v.enrolled)}건 — 등록하지 않은 상담의 공통점을 분석해 줘`,
      reason: `등록률 ${rate}% · 상담 뒤 일주일 지난 것만`,
    });
  }
  const e = s.exams;
  if (e && e.schools > 0 && e.earliest) {
    const dday = daysBetween(today, e.earliest);
    out.push({
      key: "exams",
      score: 45 + (dday <= 7 ? 20 : 0),
      text: `3주 안에 내신이 시작하는 학교 ${n(e.schools)}곳 — 해당 학생들의 출석·숙제·진도 준비 상태를 점검해 줘`,
      reason: `가장 이른 시험 ${md(e.earliest)}${dday >= 0 ? `(D-${dday})` : ""} · 학원 설정에 적어 둔 시험 일정 기준`,
    });
  }
  return out;
}

/** 신호 → 추천 질문 6개(심한 순 · 같은 글 한 번 · 모자라면 고정 문장 — 신호가 다룬 주제는 뺀다). */
export function buildSuggestions(signals: SuggestionSignals, today: string, count = SUGGESTION_COUNT): AssistantSuggestion[] {
  const scored = scoreSignals(signals, today).sort((x, y) => y.score - x.score);
  const out: AssistantSuggestion[] = [];
  const topics = new Set<Topic>();
  for (const s of scored) {
    if (out.length >= count) break;
    if (out.some((o) => o.text === s.text)) continue;
    out.push({ text: s.text, ...(s.reason ? { reason: s.reason } : {}), ...(s.key ? { key: s.key } : {}) });
    if (s.topic) topics.add(s.topic);
  }
  for (const f of FALLBACK_SUGGESTIONS) {
    if (out.length >= count) break;
    const topic = STATIC_TOPIC[f.text];
    if (topic && topics.has(topic)) continue;
    if (out.some((o) => o.text === f.text)) continue;
    out.push(f);
  }
  return out;
}

// ───────────────────────────── 화면 캐시 · NEW ─────────────────────────────

/** 브라우저에 두는 한 벌(마지막 사람 하나). */
export type SuggestionCache = {
  v: 2;
  scope: string;
  day: string;
  items: AssistantSuggestion[];
  /** 직전 묶음의 주제 열쇠(NEW 판정 기준). */
  prev: string[];
  /** 묶음(주제)이 마지막으로 바뀐 한국 날짜 — NEW는 이날에만 보인다. */
  newDay: string;
};

export const SUGGESTION_CACHE_KEY = "aywa.assistant.suggestions.v2";

const isItem = (x: unknown): x is AssistantSuggestion =>
  !!x && typeof x === "object" && typeof (x as AssistantSuggestion).text === "string" && (x as AssistantSuggestion).text.trim().length > 0 &&
  ((x as AssistantSuggestion).reason === undefined || typeof (x as AssistantSuggestion).reason === "string") &&
  ((x as AssistantSuggestion).key === undefined || typeof (x as AssistantSuggestion).key === "string");

/** 저장된 글 → 캐시(모양이 틀리면 null). */
export function parseSuggestionCache(raw: string | null): SuggestionCache | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SuggestionCache>;
    if (v?.v !== 2 || typeof v.scope !== "string" || typeof v.day !== "string" || typeof v.newDay !== "string") return null;
    if (!Array.isArray(v.items) || !v.items.every(isItem) || !Array.isArray(v.prev) || !v.prev.every((p) => typeof p === "string")) return null;
    return { v: 2, scope: v.scope, day: v.day, items: v.items, prev: v.prev, newDay: v.newDay };
  } catch {
    return null;
  }
}

/** 주제 열쇠 — 신호 질문은 `key`, 없으면(옛 응답) 글 그대로. */
export const suggestionKey = (i: AssistantSuggestion) => i.key ?? i.text;
const sameKeys = (a: readonly AssistantSuggestion[], b: readonly AssistantSuggestion[]) => {
  const x = a.map(suggestionKey).sort();
  const y = b.map(suggestionKey).sort();
  return x.length === y.length && x.every((k, i) => k === y[i]);
};

/**
 * 새로 받은 묶음 → 다음 캐시. 다른 사람(scope)의 것이었거나 처음이면 직전 묶음 = 고정 문장(그동안 보던 것).
 * 주제가 그대로면(숫자만 바뀜) 직전 묶음·NEW 날짜를 그대로 · 주제가 바뀌었으면 지금 보던 묶음이 직전 묶음이 되고 오늘이 NEW 날짜다.
 */
export function nextSuggestionCache(prior: SuggestionCache | null, scope: string, day: string, items: AssistantSuggestion[]): SuggestionCache {
  const mine = prior && prior.scope === scope ? prior : null;
  if (!mine) return { v: 2, scope, day, items, prev: FALLBACK_SUGGESTIONS.map(suggestionKey), newDay: day };
  if (sameKeys(mine.items, items)) return { v: 2, scope, day, items, prev: mine.prev, newDay: mine.newDay };
  return { v: 2, scope, day, items, prev: mine.items.map(suggestionKey), newDay: day };
}

/** NEW를 붙일 글 — 묶음이 바뀐 그날, 직전 묶음에 없던 주제의 신호 질문(고정 문장 제외). */
export function newSuggestionTexts(cache: Pick<SuggestionCache, "items" | "prev" | "newDay">, today: string): ReadonlySet<string> {
  if (cache.newDay !== today) return new Set();
  const prev = new Set(cache.prev);
  return new Set(cache.items.filter((i) => !suggestionKey(i).startsWith("static:") && !prev.has(suggestionKey(i))).map((i) => i.text));
}

/** 서버에 '이 묶음이 있다'고 알리는 표(사람·날짜). */
export const haveKey = (scope: string, day: string) => `${scope}.${day}`;
