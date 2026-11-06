import { formatKoreanDate, isValidYmd, kstDateOf } from "@/lib/date-kst";
import type { NetEdge, NetGroupLevel, NetNode } from "./types";

/**
 * 네트워크 '개별 기록'의 **날짜 묶음**(원장 2026-11-06 *"연도별 -> 월별 -> 날짜별"* · *"상담처럼 연도별 월별 일자별로"*) — 순수 함수.
 * 영역 아래 날짜 있는 기록을 한꺼번에 뿌리지 않고 **연도 → 월 → (같은 날 기록이 둘 이상이면) 일자**로 묶는다. 하루에 한 건이면 그 기록이 곧
 * 일자다(묶음 점을 겹으로 세우지 않는다). 묶음 이름 = 기간 + 건수('2026년 · 27건' · '10월 · 23건' · '7일 · 12건') · 묶음 아래 기록 이름 =
 * '7일 · 제목'(월 아래) · '제목'(일자 아래). 날짜 글은 한 화면 한 표기 — 연·월·일 한글(앱 공용 `formatKoreanDate`와 같은 꼴).
 *
 * 점 id = `grp:<조각 key>:<YYYY[-MM[-DD]]>` — 같은 영역·같은 기간이면 판을 다시 짜도 같은 id(펼친 상태·보간이 이 id로 잇는다).
 */

/**
 * 기록의 날짜(YYYY-MM-DD) — 달력에 있는 날만, 아니면 null(없는 날을 지어내지 않는다). 시각이 붙은 값은 **KST 날짜**로(`kstDateOf` —
 * 앞 10글자를 자르면 UTC 날짜라 아침 9시 전 기록이 하루 앞으로 묶인다).
 */
export function recordYmd(d: string | null | undefined): string | null {
  if (!d) return null;
  // 시간대(Z · ±09:00)가 붙은 시각만 KST로 바꾼다 — 시간대 없는 시각은 서버(UTC)·브라우저(KST)가 다르게 읽으니 벽시계 날짜(앞 10글자) 그대로.
  const zoned = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/.test(d);
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : zoned ? kstDateOf(d) : /^\d{4}-\d{2}-\d{2}[T ]/.test(d) ? d.slice(0, 10) : null;
  return ymd && isValidYmd(ymd) ? ymd : null;
}

/** hover 카드·기록 패널의 날짜 — '2026년 9월 30일 (수)'. 날짜가 아니면 원문 그대로. */
export function netDateText(d: string | null | undefined): string | null {
  if (!d) return null;
  const ymd = recordYmd(d);
  return ymd ? formatKoreanDate(ymd) : d;
}

const num = (s: string) => Number(s);
/** 묶음의 긴 이름(hover 카드 제목 · 기록 패널 제목) — '2026년' · '2026년 10월' · '2026년 10월 7일 (수)'. */
export function groupTitle(period: string): string {
  const [y, m, d] = period.split("-");
  if (d) return formatKoreanDate(period);
  return m ? `${num(y)}년 ${num(m)}월` : `${num(y)}년`;
}
/** 묶음의 짧은 이름(판) — 위 단계가 이미 말한 것은 되풀이하지 않는다: '2026년' · '10월' · '7일'. */
function groupShort(period: string): string {
  const [y, m, d] = period.split("-");
  return d ? `${num(d)}일` : m ? `${num(m)}월` : `${num(y)}년`;
}

export const groupId = (sectorKey: string, period: string) => `grp:${sectorKey}:${period}`;
export const isGroupId = (id: string) => id.startsWith("grp:");

/**
 * 한 영역의 날짜 있는 기록 → 묶음 점·선. `records`의 `parent`·`label`을 채운다(같은 판을 짜는 중이라 그 자리에서 고친다).
 * 차례 = 최근이 먼저(연도·월·일자·기록 모두).
 */
export function timeTree(hub: NetNode, records: NetNode[]): { groups: NetNode[]; edges: NetEdge[] } {
  const key = hub.sectorKey ?? hub.id.replace(/^hub:/, "");
  const groups: NetNode[] = [];
  const edges: NetEdge[] = [];
  const sorted = [...records].sort((a, b) => (recordYmd(b.date) ?? "").localeCompare(recordYmd(a.date) ?? "") || a.id.localeCompare(b.id));
  const group = (period: string, level: NetGroupLevel, parent: string, tally: number, rel: string): string => {
    const id = groupId(key, period);
    groups.push({ id, title: groupTitle(period), label: `${groupShort(period)} · ${tally}건`, kind: "group", level, tone: hub.tone, hub: hub.id, parent, sectorKey: hub.sectorKey, date: period, tally });
    edges.push({ from: parent, to: id, rel });
    return id;
  };
  const by = <T,>(xs: T[], k: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(k(x), [...(m.get(k(x)) ?? []), x]);
    return m;
  };
  const ymd = (n: NetNode) => recordYmd(n.date)!;
  for (const [year, inYear] of by(sorted, (n) => ymd(n).slice(0, 4))) {
    const yId = group(year, "year", hub.id, inYear.length, "연도");
    for (const [month, inMonth] of by(inYear, (n) => ymd(n).slice(0, 7))) {
      const mId = group(month, "month", yId, inMonth.length, "월");
      for (const [day, inDay] of by(inMonth, ymd)) {
        const dId = inDay.length > 1 ? group(day, "day", mId, inDay.length, "일자") : null;
        for (const r of inDay) {
          r.parent = dId ?? mId;
          r.label = dId ? r.title : `${groupShort(day)} · ${r.title}`;
          edges.push({ from: r.parent, to: r.id, rel: "기록" });
        }
      }
    }
  }
  return { groups, edges };
}
