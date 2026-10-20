"use client";

import { Fragment, type CSSProperties, type ReactNode } from "react";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import type { OverviewSnapshot, Sections } from "@/features/dashboard/overview/model";
import { KPI_KEYS, type KpiKey } from "@/features/dashboard/overview/layout";
import { todayLevelTestList } from "@/features/dashboard/overview/display";
import { monthAheadWindow, windowUntilLabel } from "@/features/dashboard/overview/upcoming-window";
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
import { programLabel, programSubjectsOf, visiblePrograms, type Program } from "@/features/students/enrollment/program";
import type { MenuKey } from "@/lib/permissions";
import { number } from "./charts";
import { KpiCard } from "./kpi-card";
import { identifyCard } from "./card-id";
import { FirstClassPopup, StudentsPopup, WithdrawalsPopup } from "./kpi-popups";
import { AbsentPopup, EnrolledTodayPopup, IntakePopup, LevelTestPopup, MakeupPopup } from "./kpi-popups-day";
import s from "./overview.module.css";

const count = (n: number | null | undefined) => (n == null ? "—" : number(n));

/**
 * 열 수는 **실제로 선 카드 수**에서 나온다(D2) — 역할에 따라 5칸이면 5열, 빈 칸을 만들지 않는다.
 * 넓을 때 n열 · 중간 폭은 n≤3이면 n열, 4면 2열, 그 이상 3열(남는 자리는 마지막 카드가 채운다) ·
 * 좁을 때 2열(홀수 번째 마지막 카드는 CSS가 두 칸으로).
 */
export function kpiGridVars(n: number): CSSProperties {
  // 8칸(금일 등록 포함)은 4 × 2 — 3열이면 3·3·2로 마지막 줄만 넓어진다.
  const mid = n === 4 ? 2 : n === 8 ? 4 : Math.max(1, Math.min(n, 3));
  const rest = n % mid;
  return {
    "--kpi-n": Math.max(1, n),
    "--kpi-mid": mid,
    "--kpi-last-mid": rest === 0 ? "auto" : `span ${mid - rest + 1}`,
  } as CSSProperties;
}

/**
 * KPI 칸(원장 2026-09-11 확정 순서): 재원생 · 퇴원생 · 신규문의 · 금일입테 · **금일 등록**(2026-09-23 — 금일입테 오른쪽) ·
 * 오늘첫수업 · 전일 결석 · 보강예정.
 * 볼 권한이 없는 칸은 영역이 오지 않아 숨는다(종전 규약). ↗는 목적지 메뉴를 열 수 있을 때만 선다.
 * 🔴 금일입테는 ↗가 없다 — 캘린더 메뉴는 감춰져 있다(링크 금지 테스트가 잠근다).
 * **산정 기간**은 라벨 옆 꼬리표로(원장 2026-09-29 *"현 재원생, 이번달 퇴원 등 모두 기간 명시"* · *"날짜라기보다 이번달,
 * 이번주 같은 산정기간"*) — 라벨이 이미 기간을 말하는 칸(금일입테·금일 등록·오늘첫수업·전일 결석)은 같은 말을 덧붙이지 않는다.
 */
export type KpiCardOptions = {
  /** 놓을 칸 — 없으면 영역이 온 칸 전부(지금 화면). */
  only?: readonly KpiKey[];
  /** 칸 이름 바꾸기(편집기에서 정한 제목) — id는 `kpi:<칸>`. */
  titles?: Readonly<Record<string, string>>;
  /** 학원 전체 값이 섞인 칸 id — 과목 관리자 화면에서 '학원 전체' 꼬리표를 단다. */
  academyWide?: readonly string[];
};

/**
 * KPI 칸을 **하나씩** 만든다 — 띠(`KpiStrip`)가 한 줄로 늘어놓고, 자유 배치 격자(`free-grid`)가 칸마다 제 자리에 놓는다.
 * 카드 숫자·팝업·목적지가 같은 값을 읽는 규약은 그대로다(둘 다 이 함수 한 곳).
 */
export function kpiCards(snapshot: OverviewSnapshot, opts: KpiCardOptions = {}): { cards: Partial<Record<KpiKey, ReactNode>>; total: number } {
  const { only } = opts;
  const v: Sections = only
    ? Object.fromEntries(
        Object.entries(snapshot.sections).filter(
          ([key]) => !(KPI_KEYS as readonly string[]).includes(key) || (only as readonly string[]).includes(key),
        ),
      )
    : snapshot.sections;
  const cards: Partial<Record<KpiKey, ReactNode>> = {};
  const noteOf = (key: KpiKey, note?: string) => {
    const wide = opts.academyWide?.includes(`kpi:${key}`);
    return wide ? (note ? `${note} · 학원 전체` : "학원 전체") : note;
  };
  const today = snapshot.today;
  const can = (menu: MenuKey) => snapshot.allowed.includes(menu);
  const subjects = programSubjectsOf(snapshot.subjects);
  // EiE 구분을 쓰지 않는 학원(새 학원 기본)은 'EiE' 줄을 빼고 영어를 그 학원 과목 이름으로 — 침산은 종전 문자열 그대로.
  const eieOn = snapshot.eie !== false;
  const programLine = (counts: Record<Program, number>) =>
    visiblePrograms(eieOn).map((program) => `${programLabel(program, subjects, eieOn)} ${number(counts[program])}`).join(" · ");

  const student = v.students?.data;
  const withdrawals = v.withdrawals?.data;
  const wd = withdrawals ? countWithdrawalPrograms(withdrawals.rows) : null;
  const month = withdrawals?.month ?? today.slice(0, 7);
  const intake = v.intake?.data;
  // 숫자 = 살아 있는 입테만, 팝업 = 취소된 것도 취소선으로(원장 2026-09-30) — 한 번 계산해 카드·팝업이 같이 쓴다.
  const levelTests = v.calendar?.data ? todayLevelTestList(v.calendar.data, today) : null;
  // 금일 등록 = 오늘 콜&상담 '등록 완료'로 옮긴 상담(원장 2026-09-23). 보조 줄은 반 배정 완료 / 배정 전.
  const registered = v.enrolledToday?.data;
  const registeredAssigned = registered?.filter((row) => row.assigned).length ?? 0;
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
  // 보강예정 = **오늘부터 한 달**(원장 2026-09-16) 예약 상태의 보강(0264a) + 지난 미이행. 오늘·지남·창 뒤는 보조 줄에서 가른다.
  // 창은 **서버가 센 그 창**(`range`) — 영역이 실패해 값이 없을 때만 같은 함수로 계산한다(머리가 다른 날짜를 말하지 않게).
  const makeup = v.makeup?.data;
  const makeupUntil = windowUntilLabel(makeup?.range ?? monthAheadWindow(today));
  const makeupToday = makeup?.rows.filter((r) => r.makeupDate === today).length ?? 0;
  const makeupOverdue = makeup?.rows.filter((r) => r.overdue).length ?? 0;

  if (v.students) cards.students = (
        <KpiCard
          helpKey="dash-enrolled"
          label="재원생"
          rename={opts.titles?.["kpi:students"]}
          labelNote={noteOf("students", "현재")}
          value={count(student?.enrolled)}
          unit="명"
          detail={student ? programLine(student.programs) : "재원 상태 기준"}
          icon={<MenuGlyph name="users" size={20} />}
          error={v.students.error}
          popupTitle="현재 재원생 프로그램별 인원"
          jump={can("students") ? { href: studentsEnrolledHref(), label: "원생목록에서 재원생 보기" } : null}
        >
          <StudentsPopup data={student} subjects={subjects} canOpen={can("students")} eieOn={eieOn} />
        </KpiCard>
  );
  if (v.withdrawals) cards.withdrawals = (
        <KpiCard
          helpKey="dash-withdrawn"
          label="퇴원&수업종료"
          rename={opts.titles?.["kpi:withdrawals"]}
          labelNote={noteOf("withdrawals", "이번 달")}
          value={count(wd?.total)}
          unit="명"
          detail={wd ? `${programLine(wd)}${wd.other > 0 ? ` · 기타 ${number(wd.other)}` : ""}` : "이번 달 퇴원·수업종료 기준"}
          icon={<MenuGlyph name="userMinus" size={20} />}
          error={v.withdrawals.error}
          popupTitle={`이번 달(${Number(month.slice(5))}월 1일~오늘) 퇴원&수업종료`}
          jump={
            can("withdrawals")
              ? { href: withdrawalsMonthHref(month), label: "이번 달 퇴원·수업종료 보기" }
              : null
          }
        >
          <WithdrawalsPopup
            data={withdrawals}
            subjects={subjects}
            canFilter={can("withdrawals")}
            canOpenStudent={can("students")}
            eieOn={eieOn}
          />
        </KpiCard>
  );
  if (v.intake) cards.intake = (
        <KpiCard
          helpKey="dash-intake"
          label="신규문의"
          rename={opts.titles?.["kpi:intake"]}
          labelNote={noteOf("intake", "오늘")}
          value={count(intake?.length)}
          unit="건"
          detail={intake ? (intake.length ? `마지막 접수 ${intake[0]?.time ?? "—"}` : "오늘 접수 없음") : "오늘 접수 기준"}
          icon={<MenuGlyph name="messages" size={20} />}
          error={v.intake.error}
          popupTitle="오늘 신규문의"
          jump={can("enrollment") ? { href: intakeDayHref(today), label: "신규 콜&상담에서 오늘 접수 보기" } : null}
        >
          <IntakePopup rows={intake} canOpen={can("enrollment")} />
        </KpiCard>
  );
  if (v.calendar) cards.calendar = (
        <KpiCard
          helpKey="dash-leveltest"
          label="금일 입테"
          rename={opts.titles?.["kpi:calendar"]}
          labelNote={noteOf("calendar")}
          value={count(levelTests?.active.length)}
          unit="건"
          detail={
            levelTests
              ? [
                  levelTests.active.length
                    ? `첫 일정 ${levelTests.active[0]?.startTime?.slice(0, 5) ?? "종일"}`
                    : levelTests.cancelled
                      ? null
                      : "오늘 일정 없음",
                  // 0건이 수수께끼가 되지 않게 — 취소된 입테가 있으면 "취소 N"을 보조 줄에(원장 2026-09-30).
                  levelTests.cancelled ? `취소 ${number(levelTests.cancelled)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "학원 일정 기준"
          }
          icon={<MenuGlyph name="exam" size={20} />}
          error={v.calendar.error}
          popupTitle="오늘 레벨테스트"
          jump={null}
        >
          <LevelTestPopup list={levelTests} />
        </KpiCard>
  );
  if (v.enrolledToday) cards.enrolledToday = (
        <KpiCard
          helpKey="dash-enrolled-today"
          label="금일 등록"
          rename={opts.titles?.["kpi:enrolledToday"]}
          labelNote={noteOf("enrolledToday")}
          value={count(registered?.length)}
          unit="명"
          detail={
            registered
              ? `반 배정 ${number(registeredAssigned)} · 배정 전 ${number(registered.length - registeredAssigned)}`
              : "신규 콜&상담 등록 완료 기준"
          }
          icon={<MenuGlyph name="userCheck" size={20} />}
          error={v.enrolledToday.error}
          popupTitle="오늘 등록 완료"
          jump={null}
        >
          <EnrolledTodayPopup rows={registered} canOpen={can("enrollment")} />
        </KpiCard>
  );
  if (v.firstClass) cards.firstClass = (
        <KpiCard
          helpKey="dash-first"
          label="오늘첫수업"
          rename={opts.titles?.["kpi:firstClass"]}
          labelNote={noteOf("firstClass")}
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
  );
  if (v.absent) cards.absent = (
        <KpiCard
          helpKey="dash-absent"
          label="전일 결석"
          rename={opts.titles?.["kpi:absent"]}
          labelNote={noteOf("absent")}
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
  );
  if (v.makeup) cards.makeup = (
        <KpiCard
          helpKey="dash-makeup"
          label="보강예정"
          rename={opts.titles?.["kpi:makeup"]}
          labelNote={noteOf("makeup", "한 달")}
          value={count(makeup?.rows.length)}
          unit="건"
          detail={
            makeup
              ? `오늘 ${number(makeupToday)}${makeupOverdue > 0 ? ` · 지남 ${number(makeupOverdue)}` : ""}${
                  makeup.later > 0 ? ` · 그 뒤 ${number(makeup.later)}` : ""
                }`
              : "집계 없음"
          }
          detailPrefix={makeupUntil}
          icon={<MenuGlyph name="undo" size={20} />}
          error={v.makeup.error}
          popupTitle="오늘부터 한 달 보강 예약"
          jump={can("timetable") ? { href: makeupWeekHref(), label: "시간표 보강 탭에서 주별로 보기" } : null}
        >
          <MakeupPopup data={makeup} today={today} canOpen={can("students")} />
        </KpiCard>
  );
  for (const key of KPI_KEYS) if (cards[key]) cards[key] = identifyCard(`kpi:${key}`, cards[key]);
  return { cards, total: KPI_KEYS.filter((k) => cards[k]).length };
}

export function KpiStrip({ snapshot, only }: { snapshot: OverviewSnapshot; only?: readonly KpiKey[] }) {
  const { cards, total: shown } = kpiCards(snapshot, { only });
  if (shown === 0) return null;
  return (
    <div className={s.kpis} style={kpiGridVars(shown)} data-overview="kpis" data-kpi-n={shown}>
      {KPI_KEYS.map((k) => (cards[k] ? <Fragment key={k}>{cards[k]}</Fragment> : null))}
    </div>
  );
}
