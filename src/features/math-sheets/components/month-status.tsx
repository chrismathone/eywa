"use client";

import Link from "next/link";
import { useState } from "react";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { TONE_ACCENT_BAR, TONE_TEXT } from "@/lib/design/semantic-color";
import { BADGE_BASE, BADGE_TONE } from "@/features/attendance/cell-display";
import { BADGE_LABEL, badgeTitle } from "@/features/attendance/enrollment-span";
import { sheetPill } from "@/features/class-sheets/chrome";
import { pickPrimaryRail, railDiffLabel, type GoalRailStatus } from "../lib/goal-rail";
import type { MathSheetMonthData, MathStudentRow } from "../server/month-queries";
import { GoalRailBar, RAIL_TONE, RailStatusPill } from "./goal-rail-bar";

/**
 * 시안 B — **반별 진도 현황 표**. 초안(able 2026-09-02)의 "반별 진도 현황"을 우리 자리에.
 *
 * 행 = 학생, 열 = 목표(교재·차시) · 레일 · 진행률 · 계획 대비 · 지금 · 기록 · 일일테스트 · 과제 · 정체.
 * 초안의 DT·3LT·오답·정답률 중 **우리에게 있는 것만** 열로 세운다(확인테스트는 8월 기입 0건, 오답·3LT는
 * 대응물이 없다 — 빈 열을 지어내지 않는다).
 *
 * 🔴 행의 왼쪽 색 띠와 배지는 **대표 레일 하나**(`pickPrimaryRail`) — 카드·툴바 집계와 같은 함수.
 * ⚠️ 정렬은 이름순이 기본이고 '느린 순' 토글이 있다 — "누가 뒤처졌나"가 이 표의 존재 이유라서.
 */
const STATUS_RANK: Record<GoalRailStatus, number> = {
  behind: 0,
  on: 1,
  ahead: 2,
  done: 3,
  "not-started": 4,
  "goal-behind": 5,
  "no-goal": 6,
  "no-data": 7,
};

const TH = "bg-bg-soft border-line-faint text-text-dim border-b p-2 text-center text-[12px] font-extrabold whitespace-nowrap";
const TD = "border-line-faint border-b p-2 align-middle";

function fmtDate(d: string | null): string {
  return d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "";
}

function Row({ stu, days, classLabel, goal }: { stu: MathStudentRow; days: MathSheetMonthData["days"]; classLabel: string; goal: MathSheetMonthData["goals"][string] | undefined }) {
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
  const railTitle = primary
    ? [
        primary.startLesson ? `시작 ${primary.startLesson}` : null,
        primary.planLesson ? `계획 ${primary.planLesson}` : null,
        primary.nowLesson ? `지금 ${primary.nowLesson}` : null,
        primary.endLesson ? `목표 ${primary.endLesson}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  return (
    <tr className={`border-l-[3px] ${ended ? "bg-bg-soft border-l-line-faint" : TONE_ACCENT_BAR[tone]}`}>
      <td className={`${TD} whitespace-nowrap`}>
        <div className="flex items-center gap-1.5">
          <Link
            href={`/students/${stu.studentId}`}
            className={`hover:text-primary text-[13.5px] font-extrabold ${ended ? "text-text-faint" : ""}`}
          >
            {stu.name}
          </Link>
          <span className="text-text-faint text-[11px]">{schoolGradeLabel(stu.school, stu.grade)}</span>
          {stu.badges.map((b) => (
            <span key={`${b.kind}-${b.date}`} title={badgeTitle(b, classLabel)} className={`${BADGE_BASE} ${BADGE_TONE[b.kind]}`}>
              {BADGE_LABEL[b.kind]}
            </span>
          ))}
        </div>
      </td>
      <td className={`${TD} max-w-[200px]`}>
        {goal?.textbook ? <div className="text-primary truncate text-[12px] font-bold">{goal.textbook}</div> : null}
        {primary?.endLesson ? (
          <div className="text-text-dim truncate text-[11.5px]">{primary.endLesson}</div>
        ) : !goal?.textbook ? (
          <span className="text-text-faint text-[11px]">—</span>
        ) : null}
      </td>
      <td className={`${TD} w-[230px] min-w-[180px]`}>
        {rail ? <GoalRailBar rail={rail} size="sm" title={railTitle} /> : <span className="text-text-faint text-[11px]">위치 미상</span>}
      </td>
      <td className={`${TD} num text-center`}>
        {rail?.progressPct != null ? (
          <b className={`text-[13px] font-extrabold ${TONE_TEXT[tone]}`}>{rail.progressPct}%</b>
        ) : rail?.moved != null && rail.moved > 0 ? (
          <span className="text-text-dim text-[12px]">+{rail.moved}차시</span>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </td>
      <td className={`${TD} text-center whitespace-nowrap`}>
        {ended ? null : diff ? (
          <span className={`text-[12px] font-bold ${TONE_TEXT[tone]}`}>{diff}</span>
        ) : (
          <RailStatusPill status={status} />
        )}
      </td>
      <td className={`${TD} max-w-[220px]`}>
        {primary?.nowLesson ? (
          <div className="truncate text-[12px]">
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
          <span className="text-text-faint text-[11px]">—</span>
        )}
      </td>
      <td className={`${TD} num text-center whitespace-nowrap`}>
        <b>{written}</b>
        <span className="text-text-faint">/{came}</span>
        {unwritten > 0 ? <span className="text-danger ml-1 text-[11px] font-bold">미작성 {unwritten}</span> : null}
      </td>
      <td className={`${TD} num text-center`}>
        {m.dtAvg != null ? (
          <>
            <b>{m.dtAvg}%</b> <span className="text-text-faint text-[11px]">({m.dtCount})</span>
          </>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </td>
      <td className={`${TD} num text-center`}>
        {m.hwAvg != null ? (
          <>
            <b>{m.hwAvg}%</b> <span className="text-text-faint text-[11px]">({m.hwCount})</span>
          </>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </td>
      <td className={`${TD} text-center whitespace-nowrap`}>
        {stu.stalledDates.length > 0 ? (
          <span className="bg-amber-soft text-amber rounded-full px-2 py-0.5 text-[11px] font-bold">
            같은 진도 {stu.stalledDates.length}회
          </span>
        ) : null}
      </td>
    </tr>
  );
}

export function MonthStatus({ data }: { data: MathSheetMonthData }) {
  const [bySlow, setBySlow] = useState(false);
  if (data.days.length === 0) {
    return (
      <p className="text-text-faint rounded-2xl border border-dashed p-8 text-center text-sm">
        {data.monthLabel}에는 이 반 수업이 없습니다.
      </p>
    );
  }
  const rows = bySlow
    ? [...data.students].sort((a, b) => {
        const ra = STATUS_RANK[pickPrimaryRail(a.rails)?.rail.status ?? "no-data"];
        const rb = STATUS_RANK[pickPrimaryRail(b.rails)?.rail.status ?? "no-data"];
        if (ra !== rb) return ra - rb;
        const da = pickPrimaryRail(a.rails)?.rail.diff ?? 0;
        const db = pickPrimaryRail(b.rails)?.rail.diff ?? 0;
        return da - db;
      })
    : data.students;
  return (
    <div className="px-1">
      <div className="mb-2 flex items-center gap-2">
        <button type="button" aria-pressed={bySlow} onClick={() => setBySlow((v) => !v)} className={sheetPill(bySlow)}>
          느린 순
        </button>
        <span className="text-text-faint text-[11px]">
          왼쪽 색 띠 = 계획 대비(느림 주황 · 계획대로 초록 · 빠름 파랑 · 목표 없음 회색)
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse text-[13px] [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
          <thead>
            <tr>
              <th className={`${TH} text-left`}>학생</th>
              <th className={TH}>이 달 목표</th>
              <th className={TH}>레일 (시작 · 계획 · 지금 · 목표)</th>
              <th className={TH}>진행률</th>
              <th className={TH}>계획 대비</th>
              <th className={TH}>지금 차시</th>
              <th className={TH}>기록/출석</th>
              <th className={TH}>일일테스트</th>
              <th className={TH}>과제</th>
              <th className={TH}>정체</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((stu) => (
              <Row key={stu.studentId} stu={stu} days={data.days} classLabel={data.className} goal={data.goals[stu.studentId]} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
