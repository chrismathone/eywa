"use client";

import { TONE_TEXT } from "@/lib/design/semantic-color";
import { pickPrimaryRail, railDiffLabel } from "../lib/goal-rail";
import type { MathSheetMonthData, MathStudentRow } from "../server/month-queries";
import { RAIL_ROW_LABEL, RAIL_TONE, RailStatusPill } from "./goal-rail-bar";

/**
 * **현황 표** 보기의 오른쪽 칸들 — 초안(able 2026-09-02)의 "반별 진도 현황"을 우리 자리에.
 * 학생·이 달 목표·레일 열은 여기 없다 — 그건 왼쪽 고정열([`StudentHeadCell`](./student-head-cell.tsx))이
 * 세 보기에 공통으로 들고 있다.
 *
 * 열 = 진행률 · 계획 대비 · 지금 차시 · 기록/출석 · 일일테스트 · 과제 · 정체. 초안의 DT·3LT·오답·정답률 중
 * **우리에게 있는 것만** 세운다(확인테스트는 8월 기입 0건, 오답·3LT는 대응물이 없다 — 빈 열을 지어내지 않는다).
 * 🔴 배지·색은 **대표 레일 하나**(`pickPrimaryRail`) — 고정열 미니 레일·툴바 집계와 같은 함수.
 */
const TH = "bg-bg-soft border-line-faint text-text-dim border p-2 text-center text-[12.5px] font-extrabold whitespace-nowrap";
const TD = "border-line-faint border p-2 align-middle";

function fmtDate(d: string | null): string {
  return d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "";
}

export function StatusHeadCells() {
  return (
    <>
      <th className={TH}>진행률</th>
      <th className={TH}>계획 대비</th>
      <th className={`${TH} text-left`}>{RAIL_ROW_LABEL.now}</th>
      <th className={TH}>기록/출석</th>
      <th className={TH}>일일테스트</th>
      <th className={TH}>과제</th>
      <th className={TH}>정체</th>
    </>
  );
}

export function StatusCells({ stu, data }: { stu: MathStudentRow; data: MathSheetMonthData }) {
  const { days } = data;
  const primary = pickPrimaryRail(stu.rails);
  const rail = primary?.rail ?? null;
  const status = rail?.status ?? "no-data";
  const tone = RAIL_TONE[status];
  const ended = stu.rosterPhase === "ended";
  const written = days.filter((d) => stu.cells[d.date] === "written").length;
  const came = days.filter((d) => stu.cells[d.date] === "written" || stu.cells[d.date] === "unwritten").length;
  const unwritten = came - written;
  const diff = rail ? railDiffLabel(rail) : null;
  const m = stu.metrics;
  const dim = ended ? "bg-bg-soft" : "";
  return (
    <>
      <td className={`${TD} ${dim} num text-center`}>
        {rail?.progressPct != null ? (
          <b className={`text-[15px] font-extrabold ${TONE_TEXT[tone]}`}>{rail.progressPct}%</b>
        ) : rail?.moved != null && rail.moved > 0 ? (
          <span className="text-text-dim text-[13px]">+{rail.moved}차시</span>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </td>
      <td className={`${TD} ${dim} text-center whitespace-nowrap`}>
        {ended ? null : diff ? (
          <span className={`text-[13px] font-bold ${TONE_TEXT[tone]}`}>{diff}</span>
        ) : (
          <RailStatusPill status={status} />
        )}
      </td>
      <td className={`${TD} ${dim} max-w-[260px]`}>
        {primary?.nowLesson ? (
          <div className="text-[13px] leading-snug">
            {primary.nowGrade ? <span className="text-text-faint">{primary.nowGrade} · </span> : null}
            {primary.nowLesson}
            {rail?.nowDate ? (
              <span className="text-text-faint num"> ({fmtDate(rail.nowDate)})</span>
            ) : primary.startDate ? (
              // 이 달 기록이 없어 지난 위치를 그대로 보여 주는 중 — 그 사실을 숨기지 않는다.
              <span className="text-text-faint num"> ({fmtDate(primary.startDate)} 이후 기록 없음)</span>
            ) : null}
          </div>
        ) : (
          <span className="text-text-faint text-[12px]">—</span>
        )}
      </td>
      <td className={`${TD} ${dim} num text-center whitespace-nowrap text-[13px]`}>
        <b>{written}</b>
        <span className="text-text-faint">/{came}</span>
        {unwritten > 0 ? <span className="text-danger ml-1 text-[12px] font-bold">미작성 {unwritten}</span> : null}
      </td>
      <td className={`${TD} ${dim} num text-center text-[13px]`}>
        {m.dtAvg != null ? (
          <>
            <b>{m.dtAvg}%</b> <span className="text-text-faint text-[11.5px]">({m.dtCount}회)</span>
          </>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </td>
      <td className={`${TD} ${dim} num text-center text-[13px]`}>
        {m.hwAvg != null ? (
          <>
            <b>{m.hwAvg}%</b> <span className="text-text-faint text-[11.5px]">({m.hwCount}회)</span>
          </>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </td>
      <td className={`${TD} ${dim} text-center whitespace-nowrap`}>
        {stu.stalledDates.length > 0 ? (
          <span className="bg-amber-soft text-amber rounded-full px-2 py-0.5 text-[11.5px] font-bold">
            같은 진도 {stu.stalledDates.length}회
          </span>
        ) : null}
      </td>
    </>
  );
}
