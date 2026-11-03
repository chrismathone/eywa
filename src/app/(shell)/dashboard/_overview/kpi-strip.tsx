"use client";

import { Fragment, type CSSProperties, type ReactNode } from "react";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import type { OverviewSnapshot, Sections } from "@/features/dashboard/overview/model";
import { KPI_KEYS, type KpiKey } from "@/features/dashboard/overview/layout";
import { levelTestListIn } from "@/features/dashboard/overview/display";
import { previousDayRange, previousDayText } from "@/features/dashboard/overview/previous-day";
import { splitEnrolledRecent } from "@/features/dashboard/overview/enrolled-recent";
import { monthAheadWindow, windowUntilLabel } from "@/features/dashboard/overview/upcoming-window";
import {
  firstClassTrendHref,
  studentsFirstClassHref,
  intakeTrendHref,
  recentAbsenceRange,
  makeupWeekHref,
  studentsEnrolledHref,
  studentsStatsHref,
  withdrawalsMonthHref,
} from "@/features/dashboard/overview/kpi-links";
import { countWithdrawalPrograms } from "@/features/withdrawals/window";
import { EXIT_BASIS_TAG, countedEarlierTitle } from "@/features/withdrawals/exit-basis";
import { programLabel, programSubjectsOf, visiblePrograms, type Program } from "@/features/students/enrollment/program";
import type { MenuKey } from "@/lib/permissions";
import { number } from "./charts";
import { KpiCard } from "./kpi-card";
import { identifyCard } from "./card-id";
import { FirstClassPopup, StudentsPopup, WithdrawalsPopup } from "./kpi-popups";
import { CoursesPopup } from "./kpi-courses-popup";
import { EnrolledTodayPopup, IntakePopup, LevelTestPopup, MakeupPopup } from "./kpi-popups-day";
import { RecentAbsentPopup } from "./recent-absent-popup";
import { monthDay } from "./kpi-popup-parts";
import s from "./overview.module.css";

const count = (n: number | null | undefined) => (n == null ? "—" : number(n));

/**
 * 열 수는 **실제로 선 카드 수**에서 나온다(D2) — 역할에 따라 5칸이면 5열, 빈 칸을 만들지 않는다.
 * 넓을 때 n열 · 중간 폭은 n≤3이면 n열, 4면 2열, 그 이상 3열(남는 자리는 마지막 카드가 채운다) ·
 * 좁을 때 2열(홀수 번째 마지막 카드는 CSS가 두 칸으로).
 */
export function kpiGridVars(n: number): CSSProperties {
  // 8칸(금일 등록 포함)은 4 × 2 — 3열이면 3·3·2로 마지막 줄만 넓어진다. 9칸(강좌수, 원장 2026-10-20)은 3 × 3.
  const mid = n === 4 ? 2 : n === 8 ? 4 : Math.max(1, Math.min(n, 3));
  const rest = n % mid;
  return {
    "--kpi-n": Math.max(1, n),
    "--kpi-mid": mid,
    "--kpi-last-mid": rest === 0 ? "auto" : `span ${mid - rest + 1}`,
  } as CSSProperties;
}

/**
 * KPI 칸(원장 2026-09-11 확정 순서): 재원생 · **강좌수**(2026-10-20 — 재원생 오른쪽) · 퇴원생 · 신규문의 · 전일 입테 ·
 * **전일 / 이달 신규**(2026-09-23 '금일 등록'으로 전일 입테 오른쪽 → 2026-10-21 어제·이번 달 두 숫자로) · 오늘첫수업 · 최근 결석 · 보강예정.
 * 볼 권한이 없는 칸은 영역이 오지 않아 숨는다(종전 규약). ↗는 목적지 메뉴를 열 수 있을 때만 선다.
 * 🔴 전일 입테는 ↗가 없다 — 캘린더 메뉴는 감춰져 있다(링크 금지 테스트가 잠근다).
 * **산정 기간**은 라벨 옆 꼬리표로(원장 2026-09-29 *"현 재원생, 이번달 퇴원 등 모두 기간 명시"* · *"날짜라기보다 이번달,
 * 이번주 같은 산정기간"*) — 라벨이 이미 기간을 말하는 칸(전일 입테·전일 / 이달 신규·오늘첫수업)은 같은 말을 덧붙이지 않는다.
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
  // 강좌수 = 재원생의 수강을 학생·과목마다 한 번(원장 2026-10-20) — 재원생 칸과 같은 조회·같은 줄 판정(`summarizeCourses`).
  const course = v.courses?.data?.basis === "student-subject" ? v.courses.data : null;
  const withdrawals = v.withdrawals?.data;
  const wd = withdrawals ? countWithdrawalPrograms(withdrawals.rows) : null;
  const month = withdrawals?.month ?? today.slice(0, 7);
  const intake = v.intake?.data;
  // 전일 입테 = **전일** 레벨테스트(원장 2026-10-22 '금일 입테' → 전일 · 월요일엔 토·일 주말 전체 — 전일 / 이달 신규와 같은 기간).
  // 숫자 = 살아 있는 입테만, 팝업 = 취소된 것도 취소선으로(원장 2026-09-30) — 한 번 계산해 카드·팝업이 같이 쓴다.
  const prev = previousDayRange(today);
  const prevText = previousDayText(prev);
  const levelTests = v.calendar?.data ? levelTestListIn(v.calendar.data, prev) : null;
  // 전일 / 이달 신규 = 콜&상담 '등록 완료'로 옮긴 상담(원장 2026-09-23 '금일 등록' → 2026-10-21 어제·이번 달 두 숫자).
  // 숫자 = `전일 / 이달`, 보조 줄은 이번 달의 반 배정 완료 / 배정 전. 가르기는 팝업과 같은 함수.
  const registered = v.enrolledToday?.data;
  const recent = registered ? splitEnrolledRecent(registered, today) : null;
  const registeredAssigned = recent?.month.filter((row) => row.assigned).length ?? 0;
  const firsts = v.firstClass?.data;
  const firstCount = firsts?.filter((row) => row.kind === "first").length ?? 0;
  // 최근 결석 = **어제까지 7일**(원장 2026-10-20 — 옛 '전일 결석'을 넓혔다) 결석한 학생 · 누적 결석 많은 순은 팝업에서.
  const recentAbsent = v.absent?.data;
  const absentStudents = recentAbsent?.students;
  const absentCount = absentStudents?.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const absentContact = absentStudents?.filter((row) => row.unnotified > 0).length ?? 0;
  // 기간은 **서버가 센 창**. 영역이 실패해 값이 없을 때만 같은 함수로 계산한다(머리가 다른 기간을 말하지 않게).
  const absentRange = recentAbsent ? { from: recentAbsent.from, to: recentAbsent.to } : recentAbsenceRange(today);
  const absentWhen = `${monthDay(absentRange.from)}~${monthDay(absentRange.to)}`;
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
          jump={can("students") ? (snapshot.teacherView ? { href: studentsEnrolledHref(), label: "원생목록에서 재원생 보기" } : { href: studentsStatsHref("trend", { subject: snapshot.view?.activeSubject }), label: "원생 통계에서 재원생 추이 보기" }) : null}
        >
          <StudentsPopup data={student} subjects={subjects} canOpen={can("students")} eieOn={eieOn} />
        </KpiCard>
  );
  if (v.courses) cards.courses = (
        <KpiCard
          helpKey="dash-courses"
          label="강좌수"
          rename={opts.titles?.["kpi:courses"]}
          labelNote={noteOf("courses", "현재")}
          value={count(course?.total)}
          unit="개"
          detail={course ? Object.entries(course.subjects).map(([key, count]) => `${snapshot.subjects[key] ?? "기타 과목"} ${number(count)}`).join(" · ") : "학생별 같은 과목은 1개"}
          icon={<MenuGlyph name="book" size={20} />}
          error={v.courses.error}
          popupTitle="현재 강좌수 · 학생당 강좌 수"
          jump={can("students") ? (snapshot.teacherView ? { href: studentsEnrolledHref(), label: "원생목록에서 재원생 보기" } : { href: studentsStatsHref("courses", { subject: snapshot.view?.activeSubject }), label: "원생 통계에서 강좌수 추이 보기" }) : null}
        >
          <CoursesPopup data={course} subjectLabels={snapshot.subjects} />
        </KpiCard>
  );
  // 퇴원&수업종료는 처리한 날이 아니라 수업료를 낸 마지막 달로 센다(원장 2026-10-29) — '이번 달(1일~오늘)'이라고만 적으면 이번 달에
  // 처리한 퇴원이 0명으로 보여 오류처럼 읽혔다(원장 2026-11-03 *"오해 소지가 없도록 문구들 수정"*). 꼬리표·팝업 제목·↗에 기준을 같이 적는다.
  if (v.withdrawals) cards.withdrawals = (
        <KpiCard
          helpKey="dash-withdrawn"
          label="퇴원&수업종료"
          rename={opts.titles?.["kpi:withdrawals"]}
          labelNote={noteOf("withdrawals", `이번 달 · ${EXIT_BASIS_TAG}`)}
          value={count(wd?.total)}
          unit="명"
          detail={wd
            ? `${programLine(wd)}${wd.other > 0 ? ` · 기타 ${number(wd.other)}` : ""}${withdrawals?.carried?.length ? ` · ${countedEarlierTitle(month, withdrawals.carried.length, "명")}` : ""}`
            : `이번 달 퇴원·수업종료 · ${EXIT_BASIS_TAG}`}
          icon={<MenuGlyph name="userMinus" size={20} />}
          error={v.withdrawals.error}
          popupTitle={`${Number(month.slice(5))}월로 센 퇴원&수업종료 · ${EXIT_BASIS_TAG}`}
          jump={
            can("withdrawals")
              ? { href: withdrawalsMonthHref(month), label: `퇴원관리에서 ${Number(month.slice(5))}월로 센 퇴원·수업종료 보기` }
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
          jump={can("enrollment") ? { href: intakeTrendHref(), label: "신규 콜&상담 통계에서 문의 추이 보기" } : null}
        >
          <IntakePopup rows={intake} canOpen={can("enrollment")} />
        </KpiCard>
  );
  if (v.calendar) cards.calendar = (
        <KpiCard
          helpKey="dash-leveltest"
          label="전일 입테"
          rename={opts.titles?.["kpi:calendar"]}
          labelNote={noteOf("calendar")}
          value={count(levelTests?.active.length)}
          unit="건"
          detail={
            levelTests
              ? [
                  // 하루면 첫 일정 시각, 주말(월요일)이면 기간만 — 이틀에 걸친 '첫 일정'은 뜻이 흐리다.
                  levelTests.active.length
                    ? prev.from === prev.to
                      ? `${prevText} · 첫 일정 ${levelTests.active[0]?.startTime?.slice(0, 5) ?? "종일"}`
                      : prevText
                    : levelTests.cancelled
                      ? prevText
                      : `${prevText} 일정 없음`,
                  // 0건이 수수께끼가 되지 않게 — 취소된 입테가 있으면 "취소 N"을 보조 줄에(원장 2026-09-30).
                  levelTests.cancelled ? `취소 ${number(levelTests.cancelled)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "학원 일정 기준"
          }
          icon={<MenuGlyph name="exam" size={20} />}
          error={v.calendar.error}
          popupTitle={`전일(${prevText}) 레벨테스트`}
          jump={null}
        >
          <LevelTestPopup list={levelTests} range={prev} />
        </KpiCard>
  );
  if (v.enrolledToday) cards.enrolledToday = (
        <KpiCard
          helpKey="dash-enrolled-today"
          label="전일 / 이달 신규"
          rename={opts.titles?.["kpi:enrolledToday"]}
          labelNote={noteOf("enrolledToday")}
          value={recent ? `${number(recent.yesterday.length)} / ${number(recent.month.length)}` : "—"}
          unit="명"
          detail={
            recent
              ? `전일 ${number(recent.yesterday.length)} · 이달 ${number(recent.month.length)} · 이달 반 배정 ${number(registeredAssigned)} · 배정 전 ${number(recent.month.length - registeredAssigned)}`
              : "신규 콜&상담 등록 완료 기준"
          }
          icon={<MenuGlyph name="userCheck" size={20} />}
          error={v.enrolledToday.error}
          popupTitle={`전일 · 이달(${Number(today.slice(5, 7))}월) 신규 등록`}
          jump={null}
        >
          <EnrolledTodayPopup rows={registered} today={today} canOpen={can("enrollment")} />
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
          detail={firsts ? `첫 등원 ${firstCount} · 처음 듣는 과목 ${firsts.length - firstCount}` : "수강 시작일 기준"}
          icon={<MenuGlyph name="userPlus" size={20} />}
          error={v.firstClass.error}
          popupTitle="오늘 첫 수업"
          jump={
            !can("students")
              ? null
              : snapshot.teacherView
                ? // 강사 범위엔 원생 통계가 없다 — 종전처럼 담당 학생의 오늘 첫 수업 목록으로.
                  { href: studentsFirstClassHref(today), label: "원생목록에서 오늘 첫 수업 보기" }
                : { href: firstClassTrendHref(snapshot.view?.activeSubject), label: "원생 통계에서 첫 수업 추이 보기" }
          }
        >
          <FirstClassPopup rows={firsts} subjectLabels={snapshot.subjects} canOpen={can("students")} />
        </KpiCard>
  );
  if (v.absent) cards.absent = (
        <KpiCard
          helpKey="dash-absent"
          label="최근 결석"
          rename={opts.titles?.["kpi:absent"]}
          labelNote={noteOf("absent", "7일")}
          value={count(absentStudents?.length)}
          unit="명"
          detail={absentStudents ? `결석 ${absentCount}회 · 연락 필요 ${absentContact}명` : "출결 기준"}
          // 기간은 `detail`이 아니라 접두로 — 갱신 실패 문구가 detail을 대체해도 기간이 남는다(kpi-card 주석).
          detailPrefix={absentWhen}
          icon={<MenuGlyph name="userX" size={20} />}
          error={v.absent.error}
          popupTitle={`최근 7일 결석 (${absentWhen})`}
          // ↗ 없음 — 7일을 한 번에 보이는 출결 화면이 아직 없다(하루 결석 보기로 보내면 숫자가 갈린다). 출석부 통계 화면이 생기면 그리로.
          jump={null}
        >
          <RecentAbsentPopup data={recentAbsent} subjectLabels={snapshot.subjects} canOpen={can("students")} />
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
