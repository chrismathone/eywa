import { CONTRIBUTION_TIERS } from "@/features/student-contribution/model/relative-score";
import type { DutyNote } from "./notes";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { DUTY_KIND_KEYS, dutyKindLabel, type DutyItemView, type DutyPeriod, DUTY_KINDS } from "./kinds";
import { weekDaysOf } from "./view";

/**
 * 업무 완성도 **관리자 화면**(과목 관리자 · 원장)의 순수 조립 — DB 집계(s2_0049 rollup 3종)를 선생님 × 종류 매트릭스 · 반별 줄 ·
 * 학생별 줄 · '오늘 확인할 것'으로 접는다. 숫자는 장부(duty_items) 그대로 — 강사 홈 '내 업무'와 같은 행을 센다.
 * 과목 관리자는 담당 과목 키만 받는다(서버가 `p_subjects`로 거른다) · 원장은 전 과목 + 과목 칩(여기서 subject 열로 거른다).
 */
/**
 * 한 묶음의 셈(s2_0050) — total·done = 진척(장부 전체) · due = 기한이 온 것 · ontime = 그중 제때 끝낸 것 · lateDone = 늦게 끝낸 것 ·
 * late = **지금 지연**(열린 채 기한 지남 — 아직 손쓸 수 있는 것) · expired = 미이행 확정(일간 7일 뒤) · over7 = 7일 넘게 열린 지연.
 * due = ontime + lateDone + late + expired. 기한 전 의무는 total에만 든다.
 */
export type Counts = { total: number; done: number; due: number; ontime: number; lateDone: number; late: number; expired: number; over7: number };
export type RollupOwnerKind = Counts & { ownerId: string | null; subject: string | null; kind: string; period: DutyPeriod };
export type RollupClass = Counts & { classId: string | null; ownerId: string | null; subject: string | null };
export type RollupStudent = Counts & { studentId: string | null; classId: string | null; kind: string; lastDue: string | null };
export type OwnerInfo = Record<string, string>;
export type ClassInfo = Record<string, { name: string; subject: string | null; teacherId: string | null }>;
export type StudentInfo = Record<string, { name: string; school: string | null; grade: string | null }>;
/** 과목 범위 — null = 전 과목(원장). 배열 = 그 과목 키만(과목 관리자 — 비어 있으면 아무것도 안 보인다). labels = 키 → 학원 설정 라벨(raw 키 노출 금지). */
export type DutyAdminScope = { subjects: string[] | null; labels: Record<string, string>; /** '담당' 권한이면 본인 의무만(null = 전원). */ ownerId: string | null; /** 관리 기록(확인 · 사유 · 면제)을 남길 수 있나 — 전체 권한만. 서버 액션이 같은 판정을 한 번 더 한다. */ canNote?: boolean; /** 수업보고서 평점을 볼 수 있나 — 수업보고서 쓰기 권한(평점 열람과 같은 문 · 0450a). 본인만 보는 사람에게는 없다. */ seeRatings?: boolean };
/** 열린 채 기한이 지난 의무 한 건. inherited = 평가 시작(live_from) 전 기한 — 집계·판정에 안 들고 '이관된 미확인'으로 따로 묶는다. */
/** note = 가장 최근 관리 기록(확인 · 사유 — s2_0052). 면제한 의무는 지연에서 빠져 여기 오지 않는다. */
export type LateItem = DutyItemView & { ownerId: string | null; inherited: boolean; note?: DutyNote | null };
/** syncedAt = 장부를 마지막으로 맞춘 시각(없으면 null) — 화면의 '기준 시각'. */
export type DutyAdminData = { ownerKind: RollupOwnerKind[]; classes: RollupClass[]; late: LateItem[]; owners: OwnerInfo; classInfo: ClassInfo; syncedAt: string | null; /** 담당 반 수 · 학생 수(없으면 반 수만 트리에서 센다). */ ownerLoad?: OwnerLoadRow[]; /** 관리자 역할(원장 · 관리자)인 담당자 — 맡은 반이 없으면 선생님 목록·등수에서 뺀다. */ managerIds?: string[]; /** 평가 개시 시각(없으면 null) — 고른 기간이 통째로 그 전이면 화면이 '참고 기록'이라고 밝힌다. */ liveFrom?: string | null; /** 볼 수 있는 첫 날(없으면 제한 없음) — 이보다 앞선 기간으로는 가지 않는다. */ viewFrom?: string | null; /** 작성자 × 과목의 수업보고서 평점(볼 수 있는 사람에게만 · 없으면 열이 없다). */ ratings?: RatingRow[] };

/**
 * 기간 열쇠 — `d:YYYY-MM-DD`(하루) · `w:YYYY-MM-DD`(그 주의 월요일) · `m:YYYY-MM`(달). 원장 2026-11-11 *"달력 추가해서 날짜 이동 가능하게"* —
 * 오늘 · 이번 주 · 이번 달 · 지난 달은 빠른 단추일 뿐이고, 어느 날 · 어느 주 · 어느 달이든 볼 수 있다(앞날은 없다).
 */
export type AdminPeriod = string;
export type PeriodUnit = "day" | "week" | "month";
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;
const shiftDay = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const shiftMonth = (ym: string, n: number) => { const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const lastDayOf = (ym: string) => shiftDay(`${shiftMonth(ym, 1)}-01`, -1);
export const periodKey = (unit: PeriodUnit, anchor: string): AdminPeriod => (unit === "month" ? `m:${anchor.slice(0, 7)}` : unit === "week" ? `w:${weekDaysOf(anchor)[0]}` : `d:${anchor}`);
/** 열쇠 → 단위와 기준일(주 = 월요일 · 달 = 1일). 모양이 아니면 null. */
export function periodParts(period: AdminPeriod): { unit: PeriodUnit; anchor: string } | null {
  const body = period.slice(2);
  if (period.startsWith("d:") && YMD.test(body)) return { unit: "day", anchor: body };
  if (period.startsWith("w:") && YMD.test(body)) return { unit: "week", anchor: weekDaysOf(body)[0]! };
  if (period.startsWith("m:") && /^\d{4}-(0[1-9]|1[0-2])$/.test(body)) return { unit: "month", anchor: `${body}-01` };
  return null;
}
export const periodUnit = (period: AdminPeriod): PeriodUnit => periodParts(period)?.unit ?? "month";
/** 빠른 단추 — 오늘 · 이번 주 · 이번 달 · 지난 달. */
export function periodPresets(today: string): { key: AdminPeriod; label: string }[] {
  return [{ key: periodKey("day", today), label: "오늘" }, { key: periodKey("week", today), label: "이번 주" }, { key: periodKey("month", today), label: "이번 달" }, { key: `m:${shiftMonth(today.slice(0, 7), -1)}`, label: "지난 달" }];
}
/** 주소의 값 → 기간 열쇠(믿지 않는다). 모양이 아니거나 앞날이면 이번 달. 옛 값(today · week · month · prevMonth)도 받는다. */
export function parseAdminPeriod(raw: unknown, today: string): AdminPeriod {
  const legacy: Record<string, number> = { today: 0, week: 1, month: 2, prevMonth: 3 };
  if (typeof raw === "string" && raw in legacy) return periodPresets(today)[legacy[raw]!]!.key;
  const parts = typeof raw === "string" ? periodParts(raw) : null;
  if (!parts || parts.anchor > today) return periodKey("month", today);
  return periodKey(parts.unit, parts.anchor);
}
/** 앞 · 뒤 기간(하루 · 한 주 · 한 달). */
export function shiftPeriod(period: AdminPeriod, dir: -1 | 1): AdminPeriod {
  const parts = periodParts(period);
  if (!parts) return period;
  return parts.unit === "month" ? `m:${shiftMonth(parts.anchor.slice(0, 7), dir)}` : periodKey(parts.unit, shiftDay(parts.anchor, parts.unit === "week" ? dir * 7 : dir));
}
/** 기간 → 회차 창(KST 날짜)과 화면에 적을 이름. 끝은 오늘을 넘지 않는다(이번 주 · 이번 달은 오늘까지). */
export function adminRange(period: AdminPeriod, today: string, viewFrom: string | null = null): { from: string; to: string; label: string } {
  const parts = periodParts(period) ?? { unit: "month" as const, anchor: `${today.slice(0, 7)}-01` };
  const cap = (ymd: string) => (ymd > today ? today : ymd);
  if (parts.unit === "day") return { from: parts.anchor, to: parts.anchor, label: md(parts.anchor) };
  // 볼 수 있는 첫 날이 그 주 안에 있으면 이름도 그날부터 적는다(세는 범위와 같게).
  if (parts.unit === "week") { const to = cap(shiftDay(parts.anchor, 6)); const from = viewFrom && parts.anchor < viewFrom && viewFrom <= to ? viewFrom : parts.anchor; return { from: parts.anchor, to, label: `${md(from)} ~ ${md(to)}` }; }
  const ym = parts.anchor.slice(0, 7);
  return { from: parts.anchor, to: cap(lastDayOf(ym)), label: `${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5, 7))}월` };
}
/** 셀 주기 — 하루 · 한 주는 **일간만**(강사 홈 '오늘 내 업무'와 같은 셈) · 달 단위는 전부(월간·건별 포함). */
export function periodsOf(period: AdminPeriod): string[] | null {
  return periodUnit(period) === "month" ? null : ["daily"];
}

/** 결석으로 의무에서 빠진 것(학생 × 반 × 종류의 건수) — 칸이 비었을 때 '—' 대신 '결석'이라고 적는다(왜 없는지 보이게 · 집계에는 안 든다). */
export type AbsentRow = { studentId: string; classId: string | null; kind: string; count: number };

/** 매트릭스 열 = 종류 전부(순서 = DUTY_KINDS). 짧은 머리글. */
export const MATRIX_COLUMNS: { kind: string; label: string }[] = [
  // 이름은 종류 이름 한 곳(`DUTY_KINDS`)에서 — 표 머리 · 칩 · 미처리 목록 · 강사 화면이 같은 낱말을 쓴다.
  ...(["attendance", "report_send", "report_write", "counsel_monthly", "exam_monthly", "newcomer_call"] as const).map((kind) => ({ kind, label: DUTY_KINDS[kind].label })),
];
/**
 * pct = **기한 내 완료율** — **때가 된 업무**(`due`) 가운데 기한 안에 끝낸 것(`ontime`)의 비율(내림 — 남은 것이 있으면 100%가 아니다). 때가 된 업무가 없으면 null.
 * '때'는 집계 SQL이 가른다(s2_0064 · s2_0065 — 앱에서는 `kinds.ts`의 `dutyOpensAt`(보이기 시작) · `dutyJudgedAt`(등급에 들기 시작)이 같은 규칙):
 *   · 일간(출결 · 보고서) = **그 수업이 끝난 뒤부터**(원장 2026-11-11 *"수업시간이 지났을때 반영할것 … 수업시간이 되지도 않았는데 벌써부터 0%임"*). 아직 열리지 않은 수업의 업무는 집계에 없다.
 *     보고서는 수업이 끝나면 들어와 기한(+24시간) 전까지 '남음'으로 분모에 든다(*"남음이 있는데 100%는 말도 안됨"*).
 *   · 월간(학생 상담 · 월말평가) · 건별(신규생 관리) = **그 기한이 지난 뒤부터**(원장 *"추천으로 진행"* — 달 초부터 분모에 넣으면 잘하는 선생님도 달 내내 5~7등급이었다).
 *     그 전에는 `total − due`로 남아 **진행만** 색 없이 보인다(`shownOf` — 등급 · 전체에 들지 않는다).
 * 🔴 등급 · 등수 · 요약 칸 · 과목 관리자별 현황 · 왼쪽 목록의 별이 **모두 이 숫자 하나**다(원장 *"이렇게 빨간색이 많은데 전체 점수가 이해가 안되는데? … 왜 97%?"* · *"전체 기준으로 등급 다시 매길것"*).
 *    표의 칸에 적는 글자는 따로다 — 완료율과 미처리 몫(`cellTextOf` · 같은 날 저녁 원장 *"텍스트는 98%라고 적고 98%아래에 미처리 2%"*). '기한 내만 보기'를 켜면 칸도 이 숫자다.
 *    한 줄 안에서 칸과 '전체' 칸이 서로 다른 분모를 쓰지 말 것(둘 다 `cellTextOf`) — 종류 칸은 붉은데 전체만 초록이 되어 서로 다른 말을 한다(2026-11-11 저녁 한 번 그랬다).
 */
export type Cell = Counts & { pct: number | null };
export type CellTone = "none" | "wait" | "good" | "warn" | "bad";
export const ZERO: Counts = { total: 0, done: 0, due: 0, ontime: 0, lateDone: 0, late: 0, expired: 0, over7: 0 };
export const pctOf = (c: Counts): number | null => (c.due ? Math.floor((c.ontime / c.due) * 100) : null);
/** 내림 전 값 — **등급 · 등수는 이 값으로** 매긴다(95.9%가 96으로 올라가 1등급이 되거나 99.7%가 100%와 공동 1위가 되지 않게). */
export const exactPct = (c: Counts): number | null => (c.due ? (c.ontime / c.due) * 100 : null);
/** 때가 되기 전에 미리 끝낸 것(기한 전의 월간 · 건별 가운데 벌써 끝낸 것) — 때가 되면 '기한 안에 끝낸 것'으로 넘어간다. */
export const earlyDoneOf = (c: Counts): number => Math.max(c.done - c.ontime - c.lateDone, 0);
/** 아직 때가 안 된 업무(기한 전의 월간 · 건별) — 등급 · %에 들지 않고 진행만 보인다. */
export const pendingOf = (c: Counts): number => Math.max(c.total - c.due, 0);
/** 미처리 — 기한이 지났는데 끝내지 않은 것(지금 열려 있는 것 + 다시 할 수 없게 닫힌 '미처리 확정'). 막대의 미처리 몫 · 요약 칸 · 왼쪽 목록의 붉은 수 · '미처리만'이 모두 이 수다. */
export const missedOf = (c: Counts): number => c.late + c.expired;
/** 남음 — 때는 됐지만 기한 전이라 아직 안 끝낸 것(수업은 끝났고 보낼 보고서처럼). 분모에 든다. */
export const leftOf = (c: Counts): number => Math.max(c.due - c.ontime - c.lateDone - c.late - c.expired, 0);
/**
 * 칸에 적을 숫자 — 때가 된 업무가 있으면 그 가운데 기한 안에 끝낸 비율(`judged` · 색을 칠한다), 없으면(기한 전의 월간 · 건별뿐) **진행**(끝낸 것 ÷ 전체 · 색 없이).
 * num/den = 마우스를 올렸을 때의 분자/분모. 업무가 없으면 null.
 */
export type Shown = { judged: boolean; pct: number; num: number; den: number };
export function shownOf(c: Counts): Shown | null {
  if (!c.total) return null;
  if (c.due) return { judged: true, pct: Math.floor((c.ontime / c.due) * 100), num: c.ontime, den: c.due };
  const done = earlyDoneOf(c);
  return { judged: false, pct: Math.floor((done / c.total) * 100), num: done, den: c.total };
}
/**
 * 칸에 적는 글자 — **표의 칸 · 왼쪽 목록의 반 줄 · 학생 단계 종류 카드가 같은 규칙**을 쓴다(같은 반이 목록에서는 42%, 표에서는 71%로 보이지 않게):
 *   · 때가 된 업무가 있으면(`judged`) 완료율과 미처리 몫(`barTextOf`) — '기한 내만 보기'면 기한 내 완료율(미처리는 적지 않는다).
 *   · 없으면 진행(끝낸 것 ÷ 전체 · `shownOf`). 업무가 없으면 null.
 */
export type CellText = { judged: boolean; pct: number; num: number; den: number; missPct: number; missed: number };
export function cellTextOf(c: Counts, ontimeOnly: boolean): CellText | null {
  const shown = shownOf(c);
  if (!shown) return null;
  const bar = barTextOf(c);
  return bar && !ontimeOnly ? { judged: true, ...bar } : { ...shown, missPct: 0, missed: 0 };
}
/** '기한 내만 보기'(계정에 저장한 보기 설정 `users.ui_prefs.duties.ontimeOnly`) — 저장값이 true일 때만 켠다(없거나 모양이 다르면 끔). */
export function readDutyOntimeOnly(uiPrefs: unknown): boolean {
  const ns = uiPrefs && typeof uiPrefs === "object" && !Array.isArray(uiPrefs) ? (uiPrefs as Record<string, unknown>).duties : null;
  return !!ns && typeof ns === "object" && !Array.isArray(ns) && (ns as Record<string, unknown>).ontimeOnly === true;
}
/**
 * 한 막대를 나눈 몫 — 때가 된 업무가 어떻게 끝났나: 기한 내(`ontime`) · 기한 후 완료(`lateDone`) · 미처리(`missed` = 지금 기한 초과 + 미처리 확정) · 남음(`left` — 때는 됐고 기한 전).
 * 칸 하나가 곧 가로 막대다(원장 2026-11-11 *"가로 막대로 3등분 … 28%가 기한내, 70%가 기한외, 2%가 미처리면 가로로 28%/70%/2%를 그리는거야"*).
 * 몫은 **건수 비율 그대로**다(작은 몫을 키워 그리지 않는다 — 막대로 안 보이는 작은 몫은 막대 위 글자 '미처리 n%'가 말한다 · `barTextOf`).
 * 때가 된 업무가 없으면 빈 배열 — 진행만 있는 칸에는 막대를 그리지 않는다.
 */
export type MixKey = "ontime" | "lateDone" | "missed" | "left";
export type MixPart = { key: MixKey; count: number; share: number };
export function mixParts(c: Counts): MixPart[] {
  if (!c.due) return [];
  const raw = ([["ontime", c.ontime], ["lateDone", c.lateDone], ["missed", c.late + c.expired], ["left", leftOf(c)]] as [MixKey, number][]).filter(([, v]) => v > 0);
  const base = mixBase(c);
  return base ? raw.map(([key, count]) => ({ key, count, share: count / base })) : [];
}
/**
 * 막대와 그 위 글자의 분모 — 때가 된 업무 수(`due`). 집계가 어긋나 끝낸 것 + 미처리가 `due`를 넘으면 그 합을 쓴다
 * (막대는 몫의 합이 1이어야 하고, 글자도 같은 분모여야 '80% · 미처리 50%'처럼 서로 다른 말을 하지 않는다 — 리뷰 2026-11-11).
 */
const mixBase = (c: Counts): number => Math.max(c.due, c.ontime + c.lateDone + c.late + c.expired);
/**
 * 막대 위에 적는 숫자(원장 *"그 위에 텍스트는 98%라고 적고 98%아래에 미처리 2% 적으면 될듯"*) — 때가 된 업무 가운데:
 *   · `pct` = **완료율**(기한 내 + 기한 후 완료 · 내림 — 남은 것이 있으면 100%가 아니다) · `num`/`den` = 마우스를 올렸을 때의 분자/분모.
 *   · `missPct` = **미처리 몫**(올림 — 한 건이라도 있으면 1% 이상 · 남은 것이 없으면 완료율과 더해 100) · `missed` = 그 건수.
 * 🔴 등급 · 등수 · 요약 칸의 숫자는 이것이 아니라 **기한 내 완료율**(`pctOf` — 막대의 초록 몫)이다. 때가 된 업무가 없으면 null.
 */
export type BarText = { pct: number; num: number; den: number; missPct: number; missed: number };
/** 미처리 몫(%) — 올림. 한 건이라도 있으면 0%라고 적지 않는다(칸 · 판정 줄이 같은 셈을 쓴다). */
export const missPctOf = (missed: number, den: number): number => (missed > 0 && den > 0 ? Math.min(Math.ceil((missed / den) * 100), 100) : 0);
export function barTextOf(c: Counts): BarText | null {
  if (!c.due) return null;
  const den = mixBase(c), done = c.ontime + c.lateDone, missed = c.late + c.expired;
  return { pct: Math.floor((done / den) * 100), num: done, den, missPct: missPctOf(missed, den), missed };
}
export const EMPTY: Cell = { ...ZERO, pct: null };
export const add = (a: Counts, b: Counts): Counts => ({ total: a.total + b.total, done: a.done + b.done, due: a.due + b.due, ontime: a.ontime + b.ontime,
  lateDone: a.lateDone + b.lateDone, late: a.late + b.late, expired: a.expired + b.expired, over7: a.over7 + b.over7 });
export const cellOf = (c: Counts): Cell => ({ total: c.total, done: c.done, due: c.due, ontime: c.ontime, lateDone: c.lateDone, late: c.late, expired: c.expired, over7: c.over7, pct: pctOf(c) });
/** 아직 안 끝낸 것 전부(기한 초과 제외) — 남음(`leftOf`) + 기한 전의 월간 · 건별 가운데 안 끝낸 것. 과목 관리자별 현황의 '남음' 건수. */
export const upcomingOf = (c: Counts): number => Math.max(c.total - c.done - c.late - c.expired, 0);
/** 기한이 온 것이 없을 때 칸에 적는 진행(완료/전체) — '예정 0'처럼 끝낸 일을 안 한 것으로 보이게 하지 않는다(리뷰 2026-11-10). */
export const progressText = (c: Counts): string => `${c.done}/${c.total}`;
/** 표본이 이보다 적으면 등급을 매기지 않는다(1~2건으로 낮은 등급을 붙이지 않는다). */
export const MIN_JUDGE = 3;
/**
 * 등급 = **로열티와 같은 9등급**(원장 2026-11-10 *"미흡 양호 주의 3단계로 하지말고, % 기준으로 로열티와 동일한 등급제로 … 전체%를 기준으로"*).
 * 경계는 로열티의 누적 비율(4 · 11 · 23 · 40 · 60 · 77 · 89 · 96 · 100)을 그대로 쓴다 — 기한 내 완료율(`pct` — 표의 '전체' 칸과 같은 숫자)이 100%에서 모자란 폭으로 가른다:
 * 96%+ 1등급 · 89%+ 2등급 · 77%+ 3등급 · 60%+ 4등급 · 40%+ 5등급 · 23%+ 6등급 · 11%+ 7등급 · 4%+ 8등급 · 그 밑 9등급. 상대 순위가 아니라 그 사람의 % 하나로 정한다.
 */
export type DutyTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export function dutyTier(pct: number): DutyTier {
  const i = CONTRIBUTION_TIERS.findIndex((t) => 100 - pct <= t.ceiling);
  return ((i < 0 ? CONTRIBUTION_TIERS.length - 1 : i) + 1) as DutyTier;
}
/** 등급의 색 묶음 — 1~2등급 초록 · 3~4등급 주황 · 5등급 이하 빨강(칸 색 · 점 · 배지가 같은 묶음). */
export const tierTone = (tier: DutyTier): "good" | "warn" | "bad" => (tier <= 2 ? "good" : tier <= 4 ? "warn" : "bad");
/** 칸 색 = 판정(`judge`)과 같은 결 — 업무 없음 회색 · 때가 된 업무가 3건 미만이면 중립(평가 대기) · 그 밖은 등급의 색 묶음. */
export function cellTone(c: Cell): CellTone {
  if (!c.total) return "none";
  if (c.pct === null || c.due < MIN_JUDGE) return "wait";
  return tierTone(dutyTier(exactPct(c) ?? c.pct));
}
/** 칸 설명(마우스 오버) — 숫자의 뜻을 글로. 때가 된 업무의 결말 + (있으면) 기한 전 업무의 진행. */
export function cellTitle(c: Counts): string {
  const parts: string[] = [];
  if (c.due) parts.push(`${c.due}건 중 기한 내 완료 ${c.ontime}건`);
  if (c.lateDone) parts.push(`기한 후 완료 ${c.lateDone}`);
  if (missedOf(c)) parts.push(`미처리 ${missedOf(c)}${c.expired ? `(확정 ${c.expired})` : ""}`);
  const left = leftOf(c); if (left) parts.push(`남음 ${left}`);
  const pending = pendingOf(c); if (pending) parts.push(`진행 중 ${pending}건 중 ${earlyDoneOf(c)}건 완료`);
  return parts.join(" · ");
}
/** 과목 거르기 — undefined = 전 과목 · null = 과목 없는 것만('과목 미정') · 글자 = 그 과목. */
export type SubjectFilter = string | null | undefined;
const inSubject = (subject: string | null, filter: SubjectFilter) => filter === undefined || subject === filter;

/** 수업보고서 평점 — 그 기간 평점 수 · 평균(1~5). 준수율 · 등급과 섞지 않는 참고 열이다. */
export type RatingRow = { ownerId: string; subject: string | null; rated: number; avg: number };
export type Rating = { rated: number; avg: number };
/** 평점을 합친다(건수로 가중). */
export const addRating = (a: Rating | undefined, b: Rating | undefined): Rating | undefined => (!a ? b : !b ? a : { rated: a.rated + b.rated, avg: (a.avg * a.rated + b.avg * b.rated) / (a.rated + b.rated) });
/** 평점을 매기는 최소 건수 — 그 아래는 등수에서 뺀다. */
export const MIN_RATED = 5;
export type MatrixRow = { ownerId: string; name: string; /** 수업보고서 평점(있을 때만). */ rating?: Rating; /** 이름 옆 글(과목 · 반 수 · 학생 수). */ meta?: string; cells: Record<string, Cell>; all: Cell };
/** 담당자 × 과목의 담당 반 수 · 학생 수(s2_0053 — 고른 기간의 장부에서 겹침 없이). */
export type OwnerLoadRow = { ownerId: string | null; subject: string | null; classes: number; students: number };
/** 보이는 줄의 합(전체 줄) — '지연만'으로 거른 뒤에도 그 줄들의 합이다. */
export function foldMatrixRows(rows: readonly MatrixRow[]): MatrixRow | null {
  if (!rows.length) return null;
  const total: MatrixRow = { ownerId: "", name: "전체", cells: {}, all: EMPTY };
  for (const row of rows) {
    for (const k of DUTY_KIND_KEYS) if (row.cells[k]) total.cells[k] = cellOf(add(total.cells[k] ?? EMPTY, row.cells[k]!));
    total.all = cellOf(add(total.all, row.all));
  }
  return total;
}

export type AttentionRow = { key: string; studentId: string | null; classId: string | null; title: string; sub: string; ownerId: string | null; teacher: string; className: string; count: number; summary: string; days: number; oldest: string; students: number };
/**
 * '지금 지연' = 열린 채 기한이 지난 의무를 **담당자 × 반 × 학생**(반 알림장은 담당자 × 반)으로 묶는다 — 오래된 것 → 건수 많은 것 순.
 * 🔴 학생만으로 묶지 않는다: 한 학생을 수학·영어 두 선생님이 맡으면 한 사람 몫으로 합쳐져 엉뚱한 사람에게 지시하게 된다(리뷰 2026-11-10).
 */
export function buildAttention(items: readonly LateItem[], owners: OwnerInfo, subject: SubjectFilter, nowMs: number): AttentionRow[] {
  const by = new Map<string, AttentionRow & { kinds: Map<string, number> }>();
  for (const it of items) {
    if (!inSubject(it.subject, subject)) continue;
    const key = `${it.ownerId ?? ""}|${it.classId ?? ""}|${it.studentId ?? ""}`;
    const row = by.get(key) ?? { key, studentId: it.studentId, classId: it.classId, title: it.studentName ?? it.className ?? "학생", sub: it.studentId ? schoolGradeLabel(it.school, it.grade) : "반 알림장",
      ownerId: it.ownerId, teacher: it.ownerId ? owners[it.ownerId] ?? "" : "", className: it.className ?? "", count: 0, summary: "", days: 0, oldest: it.dueAt, students: it.studentId ? 1 : 0, kinds: new Map() };
    row.count++; row.kinds.set(it.kind, (row.kinds.get(it.kind) ?? 0) + 1);
    if (it.dueAt < row.oldest) row.oldest = it.dueAt;
    by.set(key, row);
  }
  return [...by.values()].map(({ kinds, ...row }) => ({ ...row, days: lateDays(row.oldest, nowMs), summary: [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${dutyKindLabel(k)} ${n}`).join(" · ") }))
    .sort((a, b) => a.oldest.localeCompare(b.oldest) || b.count - a.count);
}
/** 기한에서 지난 날 수(내림). */
export const lateDays = (dueIso: string, nowMs: number): number => Math.max(Math.floor((nowMs - Date.parse(dueIso)) / 86_400_000), 0);
/** 지연 표식 — 실제 지난 날 수로(단계 값은 '누구에게 전달됐다'는 뜻이 아니다). */
export const lateLabel = (days: number): string => (days >= 7 ? "7일 이상" : days >= 3 ? "3일 이상" : days >= 1 ? `${days}일` : "1일 미만");
/** 서로 다른 학생 수(같은 학생이 여러 줄에 있어도 한 명). */
export const distinctStudents = (items: readonly { studentId: string | null }[]): number => new Set(items.flatMap((i) => (i.studentId ? [i.studentId] : []))).size;

/** 종류별 지금 지연 수 요약("수업보고서 작성 12 · 출결 입력 3") — 지연 칸 아래 한 줄. */
export function lateByKind(rows: readonly RollupOwnerKind[], subject: SubjectFilter): string {
  const m = new Map<string, number>();
  for (const r of rows) if (inSubject(r.subject, subject) && r.late) m.set(r.kind, (m.get(r.kind) ?? 0) + r.late);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${dutyKindLabel(k)} ${n}`).join(" · ");
}
