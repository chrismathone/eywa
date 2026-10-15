// 직원 목록 '근무시간' 칸 문구 — 이력서 근무요일(체크) + 근무시간(한 줄 텍스트)을 한 줄로 합친다
// (원장 2026-10-06 "월~금 다 체크되어 있으면 월~금 1-9시 이런 식으로 근무시간에 합쳐서 보이게"). 순수 함수(Vitest).
import { WORKDAYS } from "./resume/resume";

const ORDER: readonly string[] = WORKDAYS.map((d) => d.key);
const LABEL: Record<string, string> = Object.fromEntries(WORKDAYS.map((d) => [d.key, d.label]));

/**
 * 근무요일 → 짧은 표기. 이어진 요일 3개 이상은 `월~금`, 그보다 짧은 덩어리는 `·`로 잇는다.
 * 예: [mon..fri] → "월~금" · [mon,wed,fri] → "월·수·금" · [mon,tue,wed,sat] → "월~수·토".
 * 모르는 키는 버리고, 순서는 저장 순서가 아니라 요일 순서로 맞춘다.
 */
export function formatWorkDays(days: readonly string[] | null | undefined): string {
  const idx = [...new Set((days ?? []).map((d) => ORDER.indexOf(d)).filter((i) => i >= 0))].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    const run = idx.slice(i, j + 1).map((k) => LABEL[ORDER[k]]);
    if (run.length >= 3) parts.push(`${run[0]}~${run[run.length - 1]}`);
    else parts.push(...run);
    i = j + 1;
  }
  return parts.join("·");
}

/** 근무시간 글에 이미 요일이 적혀 있으면(예: "월~금 14:00~22:00") 요일을 또 붙이지 않는다. */
const STARTS_WITH_DAY = /^\s*[월화수목금토일](?:\s*[~·,\-–/]|요일|\s|$)/;

/**
 * 목록 칸 한 줄. 둘 다 있으면 `월~금 13:00~21:00`, 한쪽만 있으면 그쪽만, 둘 다 없으면 null("—").
 */
export function workHoursLabel(days: readonly string[] | null | undefined, hours: string | null | undefined): string | null {
  const h = (hours ?? "").trim();
  const d = formatWorkDays(days);
  if (h && STARTS_WITH_DAY.test(h)) return h;
  if (d && h) return `${d} ${h}`;
  return d || h || null;
}
