"use client";

import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { TONE_TEXT } from "@/lib/design/semantic-color";
import { BADGE_BASE, BADGE_TONE } from "@/features/attendance/cell-display";
import { BADGE_LABEL, badgeTitle } from "@/features/attendance/enrollment-span";
import { pickPrimaryRail, railDiffLabel } from "../lib/goal-rail";
import type { MathSheetMonthData, MathStudentRow, StudentRail } from "../server/month-queries";
import { GoalRailBar, RAIL_TONE, RailStatusPill } from "./goal-rail-bar";

/**
 * 시안 A — **목표 레일 카드**. 초안(able 2026-09-02)의 "학생 개별 진도 현황"·"이로건 카드"를 우리 자리에.
 *
 * 한 학생 = 카드 하나, 트랙(현행·선행)마다 `Start ─ Plan ─ Now ─ End` 레일 한 줄 + "진행률 52% ·
 * 계획보다 5차시 빠름". 종전 B안(진도 레일)이 "이 달 얼마나 움직였나"였다면 이건 **"목표에 견줘 어디인가"**다.
 *
 * 🔴 목표가 없는 학생은 경고색이 아니라 회색이고, 목표를 적는 길(진도표 고정열)을 가리킨다.
 * ⚠️ 카드 배지의 상태는 **대표 레일 하나**(`pickPrimaryRail`)에서 온다 — 툴바 집계·현황 표와 같은 함수.
 */
function fmtDate(d: string | null): string {
  return d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "";
}

function RailRow({ r }: { r: StudentRail }) {
  const { rail } = r;
  const diff = railDiffLabel(rail);
  const tone = RAIL_TONE[rail.status];
  return (
    <div className="mb-2.5">
      <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
        <b className="text-text-dim font-extrabold">
          {r.trackLabel}
          {r.nowGrade ? <span className="text-text-faint font-semibold"> · {r.nowGrade}</span> : null}
        </b>
        <span className="num flex items-baseline gap-1.5">
          {rail.progressPct != null ? (
            <b className={`text-[13px] font-extrabold ${TONE_TEXT[tone]}`}>{rail.progressPct}%</b>
          ) : rail.moved != null && rail.moved > 0 ? (
            <b className="text-text-dim text-[12px] font-extrabold">+{rail.moved}차시</b>
          ) : null}
          {diff ? <span className={`font-bold ${TONE_TEXT[tone]}`}>{diff}</span> : null}
        </span>
      </div>
      <GoalRailBar rail={rail} size="md" />
      <div className="text-text-dim mt-0.5 text-[11.5px] leading-snug">
        {r.nowLesson ? (
          <>
            <span className="text-text-faint">지금 </span>
            {r.nowLesson}
            {rail.nowDate ? (
              <span className="text-text-faint num"> ({fmtDate(rail.nowDate)})</span>
            ) : r.startDate ? (
              <span className="text-text-faint num"> ({fmtDate(r.startDate)} 이후 기록 없음)</span>
            ) : null}
          </>
        ) : null}
        {r.endLesson ? (
          <>
            <span className="text-text-faint"> → 목표 </span>
            {r.endLesson}
          </>
        ) : rail.status === "no-goal" ? (
          <span className="text-text-faint"> · 목표를 적으면 계획선이 생깁니다</span>
        ) : null}
      </div>
    </div>
  );
}

function StudentCard({
  stu,
  days,
  classLabel,
}: {
  stu: MathStudentRow;
  days: MathSheetMonthData["days"];
  classLabel: string;
}) {
  const primary = pickPrimaryRail(stu.rails);
  const status = primary?.rail.status ?? "no-data";
  const ended = stu.rosterPhase === "ended";
  const written = days.filter((d) => stu.cells[d.date] === "written").length;
  const came = days.filter((d) => stu.cells[d.date] === "written" || stu.cells[d.date] === "unwritten").length;
  const unwritten = came - written;
  const m = stu.metrics;
  return (
    <div className={`rounded-xl border p-3 ${ended ? "border-line-faint bg-bg-soft" : "border-line bg-white"}`}>
      <div className="mb-2.5 flex items-center gap-1.5">
        <Link
          href={`/students/${stu.studentId}`}
          className={`hover:text-primary text-[13.5px] font-extrabold ${ended ? "text-text-dim" : ""}`}
        >
          {stu.name}
        </Link>
        <span className="text-text-faint text-[11px]">{schoolGradeLabel(stu.school, stu.grade)}</span>
        {stu.badges.map((b) => (
          <span key={`${b.kind}-${b.date}`} title={badgeTitle(b, classLabel)} className={`${BADGE_BASE} ${BADGE_TONE[b.kind]}`}>
            {BADGE_LABEL[b.kind]}
          </span>
        ))}
        <span className="flex-1" />
        {!ended ? <RailStatusPill status={status} /> : null}
      </div>

      {stu.rails.length > 0 ? (
        stu.rails.map((r) => <RailRow key={r.track} r={r} />)
      ) : (
        <div className="text-text-faint mb-2 text-[11px]">위치 미상 — 커리큘럼 차시로 적힌 진도가 아직 없습니다.</div>
      )}

      {/* 초안의 DT·정답률·숙제수행률 열 — 우리에게 있는 둘만(없는 열은 지어내지 않는다). */}
      <div className="border-line-faint text-text-dim mt-1 flex flex-wrap gap-x-3 gap-y-1 border-t pt-2 text-[11px]">
        <span className="num">
          기록 <b className="text-foreground">{written}</b>/{came}
          {unwritten > 0 ? <b className="text-danger"> · 미작성 {unwritten}</b> : null}
        </span>
        <span className="num">
          일일테스트{" "}
          {m.dtAvg != null ? (
            <>
              <b className="text-foreground">{m.dtAvg}%</b> <span className="text-text-faint">({m.dtCount}회)</span>
            </>
          ) : (
            <span className="text-text-faint">—</span>
          )}
        </span>
        <span className="num">
          과제{" "}
          {m.hwAvg != null ? (
            <>
              <b className="text-foreground">{m.hwAvg}%</b> <span className="text-text-faint">({m.hwCount}회)</span>
            </>
          ) : (
            <span className="text-text-faint">—</span>
          )}
        </span>
        {stu.stalledDates.length > 0 ? (
          <span className="text-amber flex items-center gap-1 font-bold">
            <EyIcon name="alert" size={10} />
            같은 진도 {stu.stalledDates.length}회
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function MonthGoalRail({ data }: { data: MathSheetMonthData }) {
  if (data.days.length === 0) {
    return (
      <p className="text-text-faint rounded-2xl border border-dashed p-8 text-center text-sm">
        {data.monthLabel}에는 이 반 수업이 없습니다.
      </p>
    );
  }
  return (
    <div className="grid gap-3 px-1 sm:grid-cols-2 xl:grid-cols-3">
      {data.students.map((stu) => (
        <StudentCard key={stu.studentId} stu={stu} days={data.days} classLabel={data.className} />
      ))}
    </div>
  );
}
