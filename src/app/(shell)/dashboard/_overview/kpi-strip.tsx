"use client";

import type { CSSProperties } from "react";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { todayLevelTests } from "@/features/dashboard/overview/display";
import { formatShortKoreanDate } from "@/lib/date-kst";
import {
  absentDayHref,
  absentKpiDate,
  intakeDayHref,
  makeupWeekHref,
  studentsEnrolledHref,
  studentsFirstClassHref,
  withdrawalsMonthHref,
} from "@/features/dashboard/overview/kpi-links";
import { countWithdrawalPrograms } from "@/features/withdrawals/window";
import { PROGRAMS, programLabel, programSubjectsOf, type Program } from "@/features/students/program";
import type { MenuKey } from "@/lib/permissions";
import { number } from "./charts";
import { KpiCard } from "./kpi-card";
import { FirstClassPopup, StudentsPopup, WithdrawalsPopup } from "./kpi-popups";
import { AbsentPopup, IntakePopup, LevelTestPopup, MakeupPopup } from "./kpi-popups-day";
import s from "./overview.module.css";

const count = (n: number | null | undefined) => (n == null ? "—" : number(n));

/**
 * 열 수는 **실제로 선 카드 수**에서 나온다(D2) — 역할에 따라 5칸이면 5열, 빈 칸을 만들지 않는다.
 * 넓을 때 n열 · 중간 폭은 n≤3이면 n열, 4면 2열, 그 이상 3열(남는 자리는 마지막 카드가 채운다) ·
 * 좁을 때 2열(홀수 번째 마지막 카드는 CSS가 두 칸으로).
 */
export function kpiGridVars(n: number): CSSProperties {
  const mid = n === 4 ? 2 : Math.max(1, Math.min(n, 3));
  const rest = n % mid;
  return {
    "--kpi-n": Math.max(1, n),
    "--kpi-mid": mid,
    "--kpi-last-mid": rest === 0 ? "auto" : `span ${mid - rest + 1}`,
  } as CSSProperties;
}

/**
 * KPI 여섯 칸(원장 2026-09-11 확정 순서): 재원생 · 퇴원생 · 신규문의 · 금일입테 · 오늘첫수업 · 전일 결석.
 * 볼 권한이 없는 칸은 영역이 오지 않아 숨는다(종전 규약). ↗는 목적지 메뉴를 열 수 있을 때만 선다.
 * 🔴 금일입테는 ↗가 없다 — 캘린더 메뉴는 감춰져 있다(링크 금지 테스트가 잠근다).
 */
export function KpiStrip({ snapshot }: { snapshot: OverviewSnapshot }) {
  const v = snapshot.sections;
  // '보강예정'(원장 2026-09-14 *"보강 예정은 가장 끝으로"*)이 맨 뒤 — 앞 여섯은 2026-09-11 확정 순서 그대로.
  const shown = [v.students, v.withdrawals, v.intake, v.calendar, v.firstClass, v.absent, v.makeup].filter(Boolean).length;
  if (shown === 0) return null;
  const today = snapshot.today;
  const can = (menu: MenuKey) => snapshot.allowed.includes(menu);
  const subjects = programSubjectsOf(snapshot.subjects);
  const programLine = (counts: Record<Program, number>) =>
    PROGRAMS.map((program) => `${programLabel(program, subjects)} ${number(counts[program])}`).join(" · ");

  const student = v.students?.data;
  const withdrawals = v.withdrawals?.data;
  const wd = withdrawals ? countWithdrawalPrograms(withdrawals.rows) : null;
  const month = withdrawals?.month ?? today.slice(0, 7);
  const intake = v.intake?.data;
  const levelTests = v.calendar?.data ? todayLevelTests(v.calendar.data, today) : null;
  const firsts = v.firstClass?.data;
  const firstCount = firsts?.filter((row) => row.kind === "first").length ?? 0;
  // 전일 결석 = **어제**(원장 2026-09-12 — 오늘은 수업을 안 하면 볼 수가 없다) 한 교시도 안 온 학생만 센다.
  // 일부 교시 결석은 팝업·목적지에서 따로 보인다.
  const absentDay = v.absent?.data;
  const absent = absentDay?.absent;
  const notified = absent?.filter((row) => row.preNotified).length ?? 0;
  const partial = absentDay?.partial.length ?? 0;
  // 기준일은 **서버가 조회한 그날**. 영역이 실패해 값이 없을 때만 같은 규칙으로 계산한다(머리·↗가 오늘로 새지 않게).
  const absentDate = absentDay?.date ?? absentKpiDate(today);
  const absentWhen = `어제 ${formatShortKoreanDate(absentDate)}`;
  // 보강예정 = **이번 주** 예약 상태의 보강(0264a). 오늘·지난 요일(미이행)은 보조 줄에서 가른다.
  const makeup = v.makeup?.data;
  const makeupToday = makeup?.rows.filter((r) => r.makeupDate === today).length ?? 0;
  const makeupOverdue = makeup?.rows.filter((r) => r.overdue).length ?? 0;

  return (
    <div className={s.kpis} style={kpiGridVars(shown)} data-overview="kpis" data-kpi-n={shown}>
      {v.students && (
        <KpiCard
          helpKey="dash-enrolled"
          label="재원생"
          value={count(student?.enrolled)}
          unit="명"
          detail={student ? programLine(student.programs) : "재원 상태 기준"}
          icon={<MenuGlyph name="users" size={20} />}
          error={v.students.error}
          popupTitle="재원생 프로그램별 인원"
          jump={can("students") ? { href: studentsEnrolledHref(), label: "원생목록에서 재원생 보기" } : null}
        >
          <StudentsPopup data={student} subjects={subjects} canOpen={can("students")} />
        </KpiCard>
      )}
      {v.withdrawals && (
        <KpiCard
          helpKey="dash-withdrawn"
          label="퇴원생"
          value={count(wd?.total)}
          unit="명"
          detail={wd ? `${programLine(wd)}${wd.other > 0 ? ` · 기타 ${number(wd.other)}` : ""}` : "이번 달 퇴원 기준"}
          icon={<MenuGlyph name="userMinus" size={20} />}
          error={v.withdrawals.error}
          popupTitle={`${Number(month.slice(5))}월 퇴원생`}
          jump={
            can("withdrawals")
              ? { href: withdrawalsMonthHref(month), label: "퇴원관리에서 이번 달 퇴원 보기" }
              : null
          }
        >
          <WithdrawalsPopup
            data={withdrawals}
            subjects={subjects}
            canFilter={can("withdrawals")}
            canOpenStudent={can("students")}
          />
        </KpiCard>
      )}
      {v.intake && (
        <KpiCard
          helpKey="dash-intake"
          label="신규문의"
          value={count(intake?.length)}
          unit="건"
          detail={intake ? (intake.length ? `마지막 접수 ${intake[0]?.time ?? "—"}` : "오늘 접수 없음") : "오늘 접수 기준"}
          icon={<MenuGlyph name="messages" size={20} />}
          error={v.intake.error}
          popupTitle="오늘 신규문의"
          jump={can("enrollment") ? { href: intakeDayHref(today), label: "콜&상담에서 오늘 접수 보기" } : null}
        >
          <IntakePopup rows={intake} canOpen={can("enrollment")} />
        </KpiCard>
      )}
      {v.calendar && (
        <KpiCard
          helpKey="dash-leveltest"
          label="금일입테"
          value={count(levelTests?.length)}
          unit="건"
          detail={
            levelTests
              ? levelTests.length
                ? `첫 일정 ${levelTests[0]?.startTime?.slice(0, 5) ?? "종일"}`
                : "오늘 일정 없음"
              : "학원 일정 기준"
          }
          icon={<MenuGlyph name="exam" size={20} />}
          error={v.calendar.error}
          popupTitle="오늘 레벨테스트"
          jump={null}
        >
          <LevelTestPopup events={levelTests} />
        </KpiCard>
      )}
      {v.firstClass && (
        <KpiCard
          helpKey="dash-first"
          label="오늘첫수업"
          value={count(firsts?.length)}
          unit="명"
          detail={firsts ? `첫 등원 ${firstCount} · 새 과목 ${firsts.length - firstCount}` : "수강 시작일 기준"}
          icon={<MenuGlyph name="userPlus" size={20} />}
          error={v.firstClass.error}
          popupTitle="오늘 첫 수업"
          jump={
            can("students") ? { href: studentsFirstClassHref(today), label: "원생목록에서 오늘 첫 수업 보기" } : null
          }
        >
          <FirstClassPopup rows={firsts} subjectLabels={snapshot.subjects} canOpen={can("students")} />
        </KpiCard>
      )}
      {v.absent && (
        <KpiCard
          helpKey="dash-absent"
          label="전일 결석"
          value={count(absent?.length)}
          unit="명"
          detail={
            absent
              ? `연락 필요 ${absent.length - notified} · 사전 통보 ${notified}${partial > 0 ? ` · 일부 교시 ${partial}` : ""}`
              : "출결 기준"
          }
          // 기준일은 `detail`이 아니라 접두로 — 갱신 실패 문구가 detail을 대체해도 '어제'가 남는다(kpi-card 주석).
          detailPrefix={absentWhen}
          icon={<MenuGlyph name="userX" size={20} />}
          error={v.absent.error}
          popupTitle={`${absentWhen} 결석 학생`}
          jump={
            can("attendance")
              ? { href: absentDayHref(absentDate), label: `출석부에서 ${absentWhen} 결석 학생 보기` }
              : null
          }
        >
          <AbsentPopup day={absentDay} subjectLabels={snapshot.subjects} canOpen={can("students")} />
        </KpiCard>
      )}
      {v.makeup && (
        <KpiCard
          helpKey="dash-makeup"
          label="보강예정"
          value={count(makeup?.rows.length)}
          unit="건"
          detail={
            makeup
              ? `오늘 ${number(makeupToday)}${makeupOverdue > 0 ? ` · 지남 ${number(makeupOverdue)}` : ""}${
                  makeup.later > 0 ? ` · 다음 주 이후 ${number(makeup.later)}` : ""
                }`
              : "집계 없음"
          }
          detailPrefix="이번 주"
          icon={<MenuGlyph name="undo" size={20} />}
          error={v.makeup.error}
          popupTitle="이번 주 보강 예약"
          jump={can("timetable") ? { href: makeupWeekHref(), label: "시간표 보강 탭에서 이번 주 보기" } : null}
        >
          <MakeupPopup data={makeup} today={today} canOpen={can("students")} />
        </KpiCard>
      )}
    </div>
  );
}
