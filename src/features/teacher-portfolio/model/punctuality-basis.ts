/**
 * 강사 근태의 그날 기준 — 원장 2026-10-15 *"추천으로 진행. 직원마다 일부 출근시간 퇴근시간 다른 직원이 있음"*. 순수 함수.
 *
 * - 기준 시각: 원장이 넣은 개인 출퇴근 시각(그 요일)이 있으면 그 값, 없으면 그날 맡은 수업 — 첫 수업 시작(− 설정한 분) · 마지막 수업 끝.
 *   '맡은 수업'은 보고서·출결 지표와 같은 판정(`classDays`의 교시 담당 — 담임 · 교시 담당 · 대신 수업)이다. 수업도 개인 시각도 없는 날은 기준이 없다(세지 않는다).
 * - 증거 = **그날 수업**(출결 수업일 · 보고서 날짜가 그날)에 대해 **그날**, **근무 시간대**(기준 1시간 전 ~ 끝 1시간 뒤)에 직접 넣은 출결·쓴 보고서뿐.
 *   집에서 아침에 넣은 결석 연락 · 지난 출결 고치기 · 밤에 쓴 보고서는 증거가 아니다(그런 것으로 지각·결근이 가려지지 않게). 활동 기록은 시각이 없어 안 쓴다.
 * - 기록으로 출근: 증거가 하나라도 있으면 태그가 없어도 결근이 아니다(태그를 깜빡한 날).
 * - 도착 증거: 가장 이른 증거 시각이 출근 태그보다 이르면 그때 이미 와 있었다(메이크에듀는 그날 첫 태그를 '출근'으로 적어서, 들어올 때 깜빡하고
 *   나갈 때 한 번 찍으면 몇 시간 지각으로 보인다 — 실데이터 2026-10-15 지각 4건 전부).
 */
import type { PunctualityOptions } from "../evaluation/options";
import type { PortfolioContext } from "./context";
import { dowOf, kstDateOf } from "./dates";
import type { PortfolioSnapshot } from "./types";

export type DayBasis = { start: string; end: string | null; basis: "personal" | "lessons" };
export type DayEvidence = { recorded: boolean; firstAt: string | null };
/** 증거로 치는 시간대 — 기준 출근 1시간 전부터 기준 퇴근(없으면 출근 + 6시간) 1시간 뒤까지(분). */
const EVIDENCE_BEFORE = 60, EVIDENCE_AFTER = 60, OPEN_END = 360;

/** `HH:MM`(초는 버림) → 분. */
export const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** 시각(ISO) → 한국 시간의 그날 분. */
export const kstMinutesOf = (iso: string): number => { const t = new Date(Date.parse(iso) + 9 * 3_600_000); return t.getUTCHours() * 60 + t.getUTCMinutes(); };
const hhmmOf = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function buildPunctualityBasis(d: PortfolioSnapshot, ctx: Pick<PortfolioContext, "classDays">, options: PunctualityOptions) {
  const times = new Map<string, string[]>();
  const seen = (user: string, day: string, iso: string) => {
    if (kstDateOf(iso) !== day) return;
    const key = `${user}|${day}`;
    (times.get(key) ?? times.set(key, []).get(key)!).push(iso);
  };
  for (const r of d.attendance) if (r.recorded_by) seen(r.recorded_by, r.session_date, r.recorded_at);
  for (const r of d.reports) if (r.created_by && r.created_at) seen(r.created_by, r.report_date, r.created_at);

  /** 날 → 강사별 그날 맡은 수업의 첫 시작 · 마지막 끝(`HH:MM`). 날마다 한 번만 훑는다. */
  const byDay = new Map<string, Map<string, { start: string; end: string | null }>>();
  function lessons(teacherId: string, day: string) {
    let map = byDay.get(day);
    if (!map) {
      map = new Map();
      for (const cd of ctx.classDays(day)) {
        cd.slotTeachers.forEach((t, i) => {
          if (!t) return;
          const s = cd.slotTimes[i]!;
          const start = s.start.slice(0, 5), end = s.end ? s.end.slice(0, 5) : null;
          const was = map!.get(t);
          map!.set(t, was ? { start: start < was.start ? start : was.start, end: end && (!was.end || end > was.end) ? end : was.end } : { start, end });
        });
      }
      byDay.set(day, map);
    }
    return map.get(teacherId) ?? null;
  }

  return {
    basisOn(teacherId: string, day: string): DayBasis | null {
      const dow = dowOf(day);
      const own = options.hours.find((h) => h.userId === teacherId && (h.days as readonly string[]).includes(dow));
      if (own) return { start: own.start, end: own.end, basis: "personal" };
      const l = lessons(teacherId, day);
      if (!l) return null;
      return { start: hhmmOf(Math.max(0, minutesOf(l.start) - options.beforeMinutes)), end: l.end, basis: "lessons" };
    },
    /** 그날 근무 시간대 안의 본인 출결·보고서 — 있었나 · 가장 이른 시각. */
    evidenceOn(teacherId: string, day: string, basis: DayBasis): DayEvidence {
      const lo = minutesOf(basis.start) - EVIDENCE_BEFORE;
      const hi = (basis.end ? minutesOf(basis.end) : minutesOf(basis.start) + OPEN_END) + EVIDENCE_AFTER;
      const inside = (times.get(`${teacherId}|${day}`) ?? []).filter((iso) => { const m = kstMinutesOf(iso); return m >= lo && m <= hi; })
        .sort((a, b) => Date.parse(a) - Date.parse(b));
      return { recorded: inside.length > 0, firstAt: inside[0] ?? null };
    },
  };
}
export type PunctualityBasis = ReturnType<typeof buildPunctualityBasis>;
