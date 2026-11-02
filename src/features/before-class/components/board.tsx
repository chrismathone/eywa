"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { Toolbar, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { shortDateLabel } from "../dates";
import { DONE_CHECK, isBlankCheck, isExcused, needsSupplement, type BeforeClassCheck } from "../items";
import { saveBeforeClassCheck } from "../server/actions";
import { checkKey, type ReportDayLevels, type RosterStudent } from "../types";
import { DateCalendar } from "./date-calendar";
import { ReportPreview } from "./report-preview";
import { StudentStats } from "./student-stats";
import { CheckTable } from "./check-table";
import { MonthTable } from "./month-table";

/**
 * 반 하나 × 달 하나의 작업면 — 달 자료를 한 번 받아 두고 날짜·보기 전환은 화면 안에서 한다(서버 왕복 없음, B7).
 * 칸을 바꾸면 화면이 먼저 바뀌고 저장은 뒤에서 한다. 같은 학생·날짜 칸의 저장은 **차례대로** 보낸다 — 빠르게 여러 번
 * 누르면 늦게 도착한 옛 값이 새 값을 덮을 수 있어서다. 저장이 실패하면 그 칸을 서버가 마지막으로 확인한 값으로 되돌린다.
 */
export function ChecklistBoard({
  classId, month, dates, students, initialChecks, autoExcused, offDays, initialDate, today, trackingStart, canEdit, report, classPicker,
}: {
  classId: string;
  month: string;
  dates: string[];
  students: RosterStudent[];
  initialChecks: Record<string, BeforeClassCheck>;
  /** '지난 수업 결석' 자동 제외 칸 열쇠(서버 판정 · 저장 안 함). */
  autoExcused: string[];
  /** 쉰 휴일(날짜 → 이름) — 통계에서 빠진다. 칸은 그대로(그날 수업했다면 체크하면 수업한 날이 된다). */
  offDays: Record<string, string>;
  initialDate: string | null;
  today: string;
  /** 이 반 첫 체크 날(서버) — 이 화면에서 처음 체크하면 아래에서 앞당긴다. */
  trackingStart: string | null;
  canEdit: boolean;
  /** 보고서 시안 재료 — 그날 보고서 값 · 반·담임 · 학원 로고. */
  report: { levels: Record<string, ReportDayLevels>; className: string; teacherName: string; logoSrc: string | null; academyName: string };
  /** 반 드롭다운 — 같은 툴바 줄 맨 앞에 선다. */
  classPicker: ReactNode;
}) {
  const [checks, setChecks] = useState(initialChecks);
  const [date, setDate] = useState(initialDate);
  const [view, setView] = useState<"check" | "month" | "stats" | "report">("check");
  // 저장이 성공할 때마다 올린다 — 학생 통계가 기억한 기록을 다시 받는 신호.
  const [version, setVersion] = useState(0);
  const router = useRouter();
  const embed = useEmbed();
  const [going, startGoing] = useTransition();
  // 달 이동은 수업일 달력 하나가 맡는다(머리의 ‹ › · 달 경계를 넘는 화살표) — 이전 화면을 둔 채 새 달을 받는다.
  const goMonth = (m: string, pick?: string) => {
    const raw = `/before-class?class=${classId}&month=${m}${pick ? `&date=${pick}` : ""}`;
    startGoing(() => router.push(embed ? withEmbed(raw) : raw));
  };
  const queues = useRef(new Map<string, Promise<unknown>>());
  // 서버가 확인한 마지막 값 — 실패하면 화면을 여기로 되돌린다(저장된 적 없는 값을 남기지 않는다).
  const saved = useRef(new Map<string, BeforeClassCheck | undefined>(Object.entries(initialChecks)));

  const change = (studentId: string, next: BeforeClassCheck) => {
    if (!date || !canEdit) return;
    const key = checkKey(studentId, date);
    setChecks((c) => {
      const copy = { ...c };
      if (isBlankCheck(next)) delete copy[key];
      else copy[key] = next;
      return copy;
    });
    const run = async () => {
      const res = await saveBeforeClassCheck({
        classId, studentId, date, missed: next.missed, absent: next.absent, card: next.card,
        excused: next.excused ?? null, excuseReason: next.excuseReason ?? null, excuseNote: next.excuseNote ?? null,
      });
      if (res.ok) {
        saved.current.set(key, isBlankCheck(next) ? undefined : next);
        setVersion((v) => v + 1);
        return;
      }
      toast.error(res.error);
      // 그 사이 같은 칸을 또 바꿨으면 그 값을 지킨다(이 저장의 값이 아직 화면에 있을 때만 되돌린다).
      setChecks((c) => {
        const stillMine = isBlankCheck(next) ? !(key in c) : c[key] === next;
        if (!stillMine) return c;
        const copy = { ...c };
        const last = saved.current.get(key);
        if (last) copy[key] = last;
        else delete copy[key];
        return copy;
      });
    };
    const chained = (queues.current.get(key) ?? Promise.resolve()).then(run, run);
    queues.current.set(key, chained);
  };

  // 추적 시작 = 서버가 아는 첫 체크와 이 화면의 가장 이른 체크 중 이른 날(처음 체크한 직후에도 월별 현황이 바로 센다).
  // 서버 값이 이 달 안이면 이 달 체크는 전부 화면에 있으니 화면 값만 믿는다(첫 체크를 지운 뒤에도 옛 시작일이 남지 않게).
  const serverStart = trackingStart && trackingStart.slice(0, 7) < month ? trackingStart : null;
  const start = [serverStart, ...Object.keys(checks).map((k) => k.split("|")[1] ?? "")].filter((d): d is string => !!d).sort()[0] ?? null;
  // 화면에 보이는 칸 = 저장된 칸 + 자동 제외 표식(저장 안 함). 추적 시작·보고서 시안은 저장된 칸(checks)만 본다.
  const viewChecks = useMemo(() => {
    const out = { ...checks };
    for (const k of autoExcused) out[k] = { ...(checks[k] ?? DONE_CHECK), autoExcused: true };
    return out;
  }, [checks, autoExcused]);
  const dayStudents = date ? students.filter((s) => s.activeDates.includes(date)) : [];
  const dayChecks = Object.fromEntries(dayStudents.map((s) => [s.id, date ? viewChecks[checkKey(s.id, date)] : undefined]));
  const supplement = dayStudents.filter((s) => { const c = dayChecks[s.id]; return c ? needsSupplement(c) : false; }).length;
  const absent = dayStudents.filter((s) => dayChecks[s.id]?.absent).length;
  const excused = dayStudents.filter((s) => { const c = dayChecks[s.id]; return c ? isExcused(c) : false; }).length;

  return (
    <div className="space-y-3">
      {/* 레일(가로 스크롤 줄)을 끈다 — 레일은 overflow로 달력 팝오버를 툴바 아래에서 잘라 버린다([[#128]]). */}
      <Toolbar rail={false} className="flex-wrap">
        {classPicker}
        <ToolbarSegment label="보기">
          <ToolbarSegmentItem active={view === "check"} onClick={() => setView("check")}>체크</ToolbarSegmentItem>
          <ToolbarSegmentItem active={view === "month"} onClick={() => setView("month")}>월별 현황</ToolbarSegmentItem>
          <ToolbarSegmentItem active={view === "stats"} onClick={() => setView("stats")}>학생 통계</ToolbarSegmentItem>
          <ToolbarSegmentItem active={view === "report"} onClick={() => setView("report")}>보고서 시안</ToolbarSegmentItem>
        </ToolbarSegment>
        {view !== "stats" ? (
          <DateCalendar month={month} dates={dates} offDays={offDays} value={date} today={today} onChange={setDate} onGo={goMonth} pending={going} />
        ) : null}
      </Toolbar>

      {dates.length === 0 && view !== "stats" ? (
        <p className="text-text-dim px-1 py-6 text-sm">이 달에는 이 반의 수업일이 없습니다.</p>
      ) : view === "stats" ? (
        <StudentStats classId={classId} students={students} version={version} />
      ) : view === "report" ? (
        date ? (
          <ReportPreview
            date={date}
            students={dayStudents}
            checks={checks}
            autoExcused={autoExcused}
            reportLevels={report.levels}
            className={report.className}
            teacherName={report.teacherName}
            logoSrc={report.logoSrc}
            academyName={report.academyName}
          />
        ) : null
      ) : view === "month" ? (
        <MonthTable dates={dates} offDays={offDays} students={students} checks={viewChecks} today={today} trackingStart={start} onPickDate={(d) => { setDate(d); setView("check"); }} />
      ) : (
        <>
          <p className="text-text-dim px-1 text-sm">
            {date ? shortDateLabel(date) : ""}
            {date && offDays[date] ? <span className="text-danger font-semibold"> · 휴일({offDays[date]}) — 수업했다면 그대로 체크하세요(통계에서 빠진 날)</span> : null}
            {" "}· 학생 {dayStudents.length}명 · 보충 필요 {supplement}명 · 결석 {absent}명{excused ? ` · 체크 제외 ${excused}명` : ""}
            {canEdit ? " · 체크한 칸 = 미흡(누르면 바로 저장)" : " · 보기 전용"}
          </p>
          {/* 날짜마다 새로 — 사유 글 상자가 다른 날 글을 들고 가지 않게. */}
          <CheckTable key={date ?? ""} students={dayStudents} checks={dayChecks} canEdit={canEdit} onChange={change} />
        </>
      )}
    </div>
  );
}
