/**
 * 메이크에듀 수납 원자료(0384a `makeedu_history_bills`) → '지난 기록' 청구서 모양 — 운영자 스크립트(`scripts/_makeedu/rebuild-history-monthly.mts`)가
 * 메이크에듀 줄을 다시 셀 때 쓰는 규칙. 순수 함수(Vitest).
 *
 * 원장 2026-10-28 *"EiE라고 되어있는데. 수납명에 교재를 보면 그 학생이 EiE 수업인지 판단가능함"* · *"LE도 줄임말이고"* ·
 * *"청구건수가 이상할정도로 적은달은 건너뛰는게 차라리 나음. 애매한것보다"*.
 *  · 2025-05 전엔 EiE·일부 과목 수업료가 **'교재' 구분**으로 청구됐다('ROOKIES (LE) 월수목 Aaron' 낸 돈 234,000 · 메모 '수강료') — 교재 줄 중
 *    요일·시간·nT 표기가 있거나 낸 돈 8만 원 이상이면 수업료(진짜 교재비는 3~4만 원 · '[EiE] Let`s Speak 1' 39,000).
 *  · 그 시기 기타 항목의 청구액 칸은 연도 숫자(2,023 · 2,024)라 믿을 수 없다 — 그 줄은 **낸 돈**을 금액으로.
 *  · EiE 수업명 — ROOKIES·LEADERS·PHONICS·Let's·Pre Let's(레벨 줄임말 (LE)·(LT)·(PL)·(LS)·(JP)는 이 낱말과 함께 나온다) → `[EiE]`를 붙여
 *    앱의 EiE 판정(`isEieLesson`)에 그대로 태운다.
 *  · 원장 시트('5개년' 탭)의 **반형태**(수납명마다 '수학 정규'·'영어 초등 정규'·'EIE얼리버드 초등'·'Trevi 중고등' …) — 운영자 스크립트가
 *    이름 판정이 모름인 반을 메우고(`classTypeGroup`·`teacherTypeGroups`) EiE와 인재원 영어를 가른다(원장 *"EiE와 영어는 과목분리를 시도해서
 *    구분할것"* · *"매쓰몽은 그냥 수학으로"*). 수업이 아닌 반('단과 내신대비'·'순공300' 스터디케어·'100점프로젝트')은 기타로(`HistoryNameHints.other`).
 */
import { subjectGroupOf, type ProgramSubject } from "@/features/students/enrollment/program";
import { explicitLessonSubjects } from "./lesson-subject-name";
import type { HistoryInvoice } from "./history-aywa";

export type HistoryBill = {
  makeedu_no: string | number;
  bill_month: Date | string;
  item_kind: string | null;
  category: string | null;
  item_name: string | null;
  billed: string | number | null;
  discount: string | number | null;
  points: string | number | null;
  paid: string | number | null;
};
export type HistoryLine = { kind: string; amount: number; paid: number; description: string };
/** 수납명 단위 표시(운영자 스크립트 — 원장 시트 반형태·원장 지시) — `eie` = EiE 수업으로 볼 이름 · `other` = 수업이 아닌 이름(기타). */
export type HistoryNameHints = { eie?: ReadonlySet<string>; other?: ReadonlySet<string> };

/** 요일 묶음('월수목')·매일·'(금)'·'3T'·'8:00' — 수업 표시. */
const LESSON_MARK = /[월화수목금토일]{2,}|매일|\(\s*[월화수목금토일]\s*\)|\d\s*T\b|\d{1,2}:\d{2}/;
const EIE_WORD = /\beie\b|rookie|leader|phonics|\blet.?s\b|pre\s*let/i;
/** 교재 구분인데 수업료로 볼 낸 돈 하한 — 진짜 교재비(3~4만 원)와 수업료(16~27만 원) 사이. */
export const BOOK_TUITION_MIN = 80_000;
/**
 * 수납명 단위 — 낸 돈이 있는 줄 중 이 몫 이상이 하한 이상이면 그 이름은 수업료(나눠 낸 줄 '75,000·50,000'도 같은 수업료 · 리뷰 2026-10-28 실측
 * 약 150줄). 침산: 수업료 이름은 가장 낮은 것이 29%('매쓰몽 사고력정규/강아 화 Jinny' — 7만5천 원 반), 교재 묶음 이름은 0.2% 아래
 * ('[EiE] ROOKIES&LEADERS' 1,417줄 중 1줄만 27만 원) — 그 사이.
 */
export const BOOK_TUITION_SHARE = 0.2;

const ym = (d: Date | string) => (typeof d === "string" ? d.slice(0, 7) : d.toISOString().slice(0, 7));
const isBookLine = (b: HistoryBill) => b.item_kind !== "lesson" && b.category === "교재";

/** 교재 구분 수납명 중 수업료인 이름 — 수업 표시가 있거나, 낸 돈이 있는 줄의 `BOOK_TUITION_SHARE` 이상이 하한 이상. */
export function bookTuitionNames(bills: readonly HistoryBill[]): Set<string> {
  const tally = new Map<string, { paid: number; big: number }>();
  for (const b of bills) {
    if (!isBookLine(b) || Number(b.paid ?? 0) <= 0) continue;
    const name = String(b.item_name ?? "");
    const t = tally.get(name) ?? tally.set(name, { paid: 0, big: 0 }).get(name)!;
    t.paid++;
    if (Number(b.paid) >= BOOK_TUITION_MIN) t.big++;
  }
  const out = new Set<string>();
  for (const b of bills) {
    if (!isBookLine(b)) continue;
    const name = String(b.item_name ?? "");
    const t = tally.get(name);
    if (LESSON_MARK.test(name) || (t && t.big / t.paid >= BOOK_TUITION_SHARE)) out.add(name);
  }
  return out;
}

/**
 * 수납 한 줄 → 청구 줄. `tuitionNames` = 교재 구분 중 수업료인 수납명(`bookTuitionNames` — 주지 않으면 이 줄 하나로 판정).
 * 교재 구분 수업료의 낸 돈이 0인 줄(침산 187줄 · 미납액·할인 칸도 0)은 금액 0 — '수업' 구분 0원 줄과 같은 뜻으로 세지 않는다.
 */
export function historyLine(b: HistoryBill, tuitionNames: ReadonlySet<string> = bookTuitionNames([b]), hints: HistoryNameHints = {}): HistoryLine {
  const name = String(b.item_name ?? "");
  const paid = Number(b.paid ?? 0);
  // 수업이 아닌 이름(원장 *"단과 내신대비, 순공300, 100점프로젝트는 그냥 기타로 넘겨. 수업이 아닌듯"*) — 구분과 상관없이 기타.
  if (hints.other?.has(name)) return { kind: "기타", amount: paid, paid, description: name };
  const bookTuition = isBookLine(b) && tuitionNames.has(name);
  const lesson = b.item_kind === "lesson" || bookTuition;
  // EiE 낱말은 교재 구분에서 수업료가 된 줄에만('수업' 구분 EiE는 이미 `[EiE]`로 적혔다 — 인재원 'Phonics' 수업을 EiE로 넘기지 않게) ·
  // 원장 시트 반형태가 EiE인 이름은 구분과 상관없이.
  const eie = lesson && !/^\s*\[eie\]/i.test(name) && (hints.eie?.has(name) || (bookTuition && EIE_WORD.test(name)));
  const amount = bookTuition ? paid : Number(b.billed ?? 0) - Number(b.discount ?? 0) - Number(b.points ?? 0);
  return { kind: lesson ? "수업" : String(b.category ?? "기타"), amount, paid, description: eie ? `[EiE] ${name}` : name };
}

/**
 * 원장 시트의 한 수납명 반형태 — 한 반형태가 그 이름 줄의 `share` 이상일 때만(반이 중간에 다른 묶음으로 옮겨 섞였으면 정하지 않는다).
 * 앞뒤 공백만 다른 반형태('수학 정규'·'수학 정규 ')는 하나로 센다.
 */
export function dominantClassType(counts: Readonly<Record<string, number>> | undefined, share = 0.8): string | null {
  const merged = new Map<string, number>();
  for (const [t, n] of Object.entries(counts ?? {})) if (t.trim() && n > 0) merged.set(t.trim(), (merged.get(t.trim()) ?? 0) + n);
  const total = [...merged.values()].reduce((s, n) => s + n, 0);
  const [top] = [...merged].sort((a, b) => b[1] - a[1]);
  return top && top[1] / total >= share ? top[0] : null;
}

/**
 * 반형태 → 묶음 — 'EIE…' = EiE(낱말로만 — 'Leiea'는 아니다) · '매쓰몽 …' = 수학(원장 *"매쓰몽은 그냥 수학으로 편입"*) · 과목 이름이 적힌
 * 반형태('수학 정규'·'인재원수학 초등'·'영어 고등'·'국어 특강') = 그 과목 — 수업명 판정과 같은 규칙(`explicitLessonSubjects` — '외국어'·'한국어'·
 * '과학고'는 과목이 아니고 영문 이름은 낱말로만 · 'Arthur'는 'Art'가 아니다) · 두 과목이면 모름. 강사형('Trevi 중고등')·과목 아닌 것('순공300
 * 프로그램')은 null.
 */
export function classTypeGroup(type: string, subjects: readonly ProgramSubject[]): string | null {
  if (/(?<![a-z])eie(?![a-z])/i.test(type)) return "eie";
  const text = /매쓰몽|매스몽/.test(type) ? `${type} 수학` : type;
  const found = new Set(explicitLessonSubjects(text, subjects).map((s) => subjectGroupOf(s.key, subjects)).filter((g): g is string => !!g));
  return found.size === 1 ? [...found][0]! : null;
}

/** 강사형 반형태 — 영문 이름으로 시작('Trevi 중고등'·'Celine 초중등'). '순공300 프로그램'·'기타 청구'·'단과 내신대비'는 아니다. */
export const isTeacherClassType = (type: string) => /^[A-Z][a-z]+\s/.test(type);

/**
 * 강사형 반형태 → 묶음 — 이름 판정이 정한 수업명 줄의 `purity` 이상이 한 묶음이고 `minRows`줄 이상이며 **모름 줄보다 많을 때**(정해진 줄
 * 조금으로 모름 줄 대부분을 메우지 않는다 · 모름 줄은 순도 셈에서 뺀다).
 * 침산: Trevi·Dior·Celine·Jinny·Peanut 수학 100% · Jane·Julie·Mina 영어 100% · Sarah는 수학 72%·영어 27%(Forever 수학 반이 같은 반형태)라 못 정한다.
 */
export function teacherTypeGroups(rows: readonly { type: string; group: string | null; weight: number }[], purity = 0.95, minRows = 50): Map<string, string> {
  const tally = new Map<string, Map<string, number>>();
  const unknown = new Map<string, number>();
  for (const r of rows) {
    if (!isTeacherClassType(r.type)) continue;
    if (!r.group) {
      unknown.set(r.type, (unknown.get(r.type) ?? 0) + r.weight);
      continue;
    }
    const t = tally.get(r.type) ?? tally.set(r.type, new Map()).get(r.type)!;
    t.set(r.group, (t.get(r.group) ?? 0) + r.weight);
  }
  const out = new Map<string, string>();
  for (const [type, t] of tally) {
    const total = [...t.values()].reduce((s, v) => s + v, 0);
    const [g, v] = [...t].sort((a, b) => b[1] - a[1])[0]!;
    if (total >= minRows && v / total >= purity && total > (unknown.get(type) ?? 0)) out.set(type, g);
  }
  return out;
}

/** 학생(원생번호)·청구월마다 청구서 한 장. */
export function historyInvoices(bills: readonly HistoryBill[], hints: HistoryNameHints = {}): (HistoryInvoice & { line_items: HistoryLine[] })[] {
  const byKey = new Map<string, HistoryInvoice & { line_items: HistoryLine[] }>();
  const tuitionNames = bookTuitionNames(bills);
  for (const b of bills) {
    const period = ym(b.bill_month);
    const key = `${b.makeedu_no}|${period}`;
    const inv = byKey.get(key) ?? { student_id: String(b.makeedu_no), period, status: "issued", category: "tuition", line_items: [], amount_total: 0, amount_paid: 0 };
    const line = historyLine(b, tuitionNames, hints);
    inv.line_items.push(line);
    inv.amount_total = Number(inv.amount_total) + line.amount;
    inv.amount_paid = Number(inv.amount_paid) + line.paid;
    byKey.set(key, inv);
  }
  return [...byKey.values()];
}

/**
 * 청구가 비정상으로 적은 달 — 앞뒤 3개월(있는 만큼) 학생 수 중앙값의 `ratio` 미만. 침산: 2025-04(23% · 청구 방식이 바뀐 달) ·
 * 2020-02(55% · 대구 코로나 휴원기 — 원장 2026-10-28 *"2020년 2월도 비울것"*) 둘만 걸린다(그다음 낮은 달이 85%).
 */
export function lowBillingMonths(totals: ReadonlyMap<string, number>, months: readonly string[], ratio = 0.6): string[] {
  const out: string[] = [];
  months.forEach((m, i) => {
    const around = [...months.slice(Math.max(0, i - 3), i), ...months.slice(i + 1, i + 4)].map((x) => totals.get(x) ?? 0).sort((a, b) => a - b);
    const med = around[Math.floor(around.length / 2)] ?? 0;
    if (med > 0 && (totals.get(m) ?? 0) / med < ratio) out.push(m);
  });
  return out;
}
