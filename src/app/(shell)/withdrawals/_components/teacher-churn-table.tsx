"use client";

import type { CSSProperties } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { tipProps } from "@/components/hover-tip/tip";
import {
  SMALL_BASE, countsFrom, deltaOf, deltaText, heatMix, rateText, yyMm,
  type ChurnCell, type ChurnMonth, type ChurnTeacherRow,
} from "@/features/withdrawals/teacher-churn";

/** 칸 배경 — 노랑(`--gold-bright`)을 퇴원율에 비례해 섞는다. 진행 중·마감 전 값은 칠하지 않는다(아직 바뀌는 값이라 색으로 견주지 않는다). */
const heat = (c: ChurnCell, open: boolean): CSSProperties | undefined => {
  const mix = open || c.state !== "ok" ? 0 : heatMix(c.rate);
  return mix ? { background: `color-mix(in srgb, var(--gold-bright) ${mix}%, var(--card))` } : undefined;
};

/** 강사 칸 폭 · 달·증감 칸의 가장 좁은 폭(이보다 좁은 창에선 가로 스크롤). */
const NAME_COL = "9.5rem";
const MIN_COL = "5.75rem";

/** "2026-11-10" → "11/10". */
const md = (ymd: string) => (ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : "");
/** 진행 중인 달 머리 — 강사마다 반영한 날이 다르면 범위로(가장 늦은 날 하나로 뭉뚱그리지 않는다). */
const throughText = (ends: readonly string[]) =>
  !ends.length ? "" : ends.length === 1 ? `${md(ends[0]!)}까지` : `${md(ends[0]!)}~${md(ends.at(-1)!)}까지(강사마다 다름)`;

function Cell({ c, month, partial, row }: { c: ChurnCell | undefined; month: ChurnMonth; partial: boolean; row: ChurnTeacherRow }) {
  const label = `${row.name} · ${yyMm(month.month)}`;
  if (!c) {
    // 재직 밖 달은 빈칸(0%·담당 없음으로 적지 않는다 — 원장 2026-11-11 "실제 선생님이 입사한 날부터. 0%하지말고").
    const from = countsFrom(row.hireDate);
    const why = from !== null && month.month < from
      ? `입사 ${row.hireDate!.slice(0, 10)} — 퇴원율은 지난달 담당 학생 기준이라 입사 다음 달부터 셉니다`
      : row.resignDate && month.month > row.resignDate.slice(0, 7)
        ? `퇴사 ${row.resignDate.slice(0, 10)} — 근무한 달까지만 셉니다`
        : "그 달은 강사평가 대상이 아니었습니다(담당 반 없음 등)";
    return <td className="text-center" {...tipProps({ title: label, lines: [why] })} />;
  }
  // 아직 바뀌는 값 — 진행 중인 달이거나, 그 강사의 그 달이 마감 대기다.
  const open = partial || !c.closed;
  const small = c.state === "ok" && c.base < SMALL_BASE;
  const tip = tipProps({
    title: label,
    meta: partial ? `진행 중 · ${md(c.end)}까지 반영` : !c.closed ? "마감 전" : null,
    rows: [
      c.state === "ok" ? ["퇴원율", rateText(c.rate!)] : null,
      c.state !== "unreadable" ? ["그만둔 학생", `${c.counted}명`] : null,
      c.state !== "unreadable" ? ["지난달 담당", `${c.base}명`] : null,
    ],
    lines: [
      c.state === "noBase" ? "지난달 이 강사가 절반 이상 맡은 학생이 없어 퇴원율이 없습니다" : null,
      c.state === "unreadable" ? "저장된 강사평가에서 퇴원율을 읽지 못했습니다 — 직원 포트폴리오에서 확인해 주세요" : null,
      small ? `담당이 ${SMALL_BASE}명 미만이라 한 명이 그만둬도 10%p 넘게 오릅니다` : null,
      open ? "아직 마감 전 — 다음 집계에서 바뀔 수 있습니다" : null,
    ],
  });
  return (
    <td className={`px-1.5 py-1.5 text-center ${open ? "bg-bg-soft" : ""}`} style={heat(c, open)} {...tip}>
      {c.state === "ok" ? (
        <>
          <span className="num block text-sm leading-tight font-bold">
            {rateText(c.rate!)}
            {small ? <span aria-label="담당 10명 미만" className="ml-0.5 align-super text-xs font-medium">＊</span> : null}
          </span>
          <span className="num block text-xs leading-tight">{c.counted}/{c.base}명</span>
        </>
      ) : c.state === "noBase" ? (
        <><span className="block text-sm leading-tight">—</span><span className="block text-xs leading-tight">담당 없음</span></>
      ) : (
        <span className="block text-xs leading-tight">확인 불가</span>
      )}
      {!partial && !c.closed ? <span className="block text-xs leading-tight">마감 전</span> : null}
    </td>
  );
}

/**
 * 강사 × 달 히트맵 표 — 칸 = 퇴원율(크게) + 그만둠/담당(작게), 배경 노랑 = 퇴원율(마감한 값만).
 * 첫 열·머리 줄은 고정(가로·세로 스크롤 — 카드 안에서만, 아래 명단을 밀지 않게). 이름을 누르면 아래 차트에서 견준다.
 */
export function TeacherChurnTable({ rows, months, pair, picked, colorOf, onPick }: {
  rows: readonly ChurnTeacherRow[];
  months: readonly ChurnMonth[];
  pair: readonly [string, string] | null;
  picked: readonly string[];
  colorOf: (id: string) => string | null;
  onPick: (id: string) => void;
}) {
  const head = "bg-card sticky top-0 border-line border-b px-1.5 py-2 text-xs font-bold";
  return (
    // 링 테두리가 잘리지 않게 안쪽 여백(#114) · 세로는 카드 안에서만 스크롤.
    // 열 너비 = 강사 칸만 고정, 달·증감 칸은 모두 같은 폭(원장 2026-11-11 *"열너비 맞춰주고"* — 자동 폭은 글자 길이에 따라 칸마다 달랐다, #97).
    <div className="-mx-1 max-h-[34rem] overflow-auto px-1">
      <table className="w-full table-fixed border-separate border-spacing-0 [&_td]:border-line-faint [&_td]:border-b [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint"
        style={{ minWidth: `calc(${NAME_COL} + ${months.length + 1} * ${MIN_COL})` }}>
        <colgroup>
          <col style={{ width: NAME_COL }} />
          {months.map((m) => <col key={m.month} />)}
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={`${head} left-0 z-20 text-left`}>강사</th>
            {months.map((m) => (
              <th key={m.month} scope="col" className={`${head} z-10 text-center`}>
                <span className="num">{yyMm(m.month)}</span>
                {m.partial ? <span className="block text-xs font-medium break-keep">진행 중 · {throughText(m.ends)}</span> : null}
              </th>
            ))}
            <th scope="col" className={`${head} z-10 text-center`}>
              증감
              <span className="num block text-xs font-medium">{pair ? `${yyMm(pair[0])} → ${yyMm(pair[1])}` : "비교할 두 달 없음"}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const on = picked.includes(r.id);
            const color = colorOf(r.id);
            const d = deltaOf(r, pair);
            return (
              <tr key={r.id}>
                <th scope="row" className={`border-line-faint sticky left-0 z-10 border-b px-2 py-1.5 text-left ${on ? "bg-primary-softer" : "bg-card"}`}>
                  <span className="flex items-center gap-1.5">
                    <button type="button" aria-pressed={on} onClick={() => onPick(r.id)}
                      className="hover:text-primary focus-visible:outline-primary min-w-0 rounded text-left text-sm font-bold break-keep focus-visible:outline-2">
                      {color ? <i aria-hidden className="mr-1 inline-block size-2.5 rounded-full align-middle" style={{ background: color }} /> : null}
                      {r.name}
                    </button>
                    <WindowLink href={`/class-review?tab=portfolio&teacher=${encodeURIComponent(r.id)}`} title={`${r.name} 직원 포트폴리오`}
                      className="hover:text-primary shrink-0 text-xs" ariaLabel={`${r.name} 직원 포트폴리오 열기`}>↗</WindowLink>
                  </span>
                  {r.subjects.length || r.hireDate || r.resignDate ? (
                    // 고정 폭 칸이라 넘치면 어절로 접는다(#116 — nowrap은 옆 칸으로 흘러넘친다).
                    <span className="block text-xs font-medium break-keep">
                      {[r.subjects.join(" · "), r.hireDate ? `입사 ${yyMm(r.hireDate.slice(0, 7))}` : "", r.resignDate ? `퇴사 ${yyMm(r.resignDate.slice(0, 7))}` : ""]
                        .filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </th>
                {months.map((m) => <Cell key={m.month} c={r.cells[m.month]} month={m} partial={m.partial} row={r} />)}
                <td className="num px-1.5 py-1.5 text-center text-sm whitespace-nowrap">
                  {d.kind === "value" ? (
                    // 방향은 +/− 가 말한다(글자색은 한 값 · 글자 아이콘을 따로 두지 않는다).
                    <span className="font-bold">{deltaText(d.delta)}</span>
                  ) : d.kind === "open" ? <span className="text-xs">마감 전</span> : <span className="text-xs">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
