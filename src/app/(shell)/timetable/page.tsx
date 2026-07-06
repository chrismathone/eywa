import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Columns3, LayoutGrid, CalendarOff, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import { getWeeklyScheduleWithStudents, getTeacherColorMap } from "@/features/timetable/server/queries";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import type { TeacherColorMap } from "@/features/timetable/lib/class-grid";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getGoogleSheetsStatus } from "@/features/integrations/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { normalizeWeekdayGrouping } from "@/features/timetable/lib/weekday-groups";
import { getWeekReferenceDate, mondayOf, thisMonday, weekRelation } from "@/features/timetable/lib/week";
import { kstToday } from "@/lib/date-kst";
import { RichGridView } from "./_components/rich-grid-view";
import {
  TimetableEditProvider,
  TimetableEditControls,
  TimetableDndArea,
} from "./_components/timetable-board";
import { TimetableToolbarActions } from "./_components/toolbar-actions";
import { WeekNav } from "./_components/week-nav";
import { WeekdayGroupTables } from "./_components/weekday-group-tables";
import { TeacherGridView } from "./_components/teacher-grid";

export const metadata = { title: "시간표 — eywa" };

type ViewMode = "basic" | "integrated" | "teacher";
// 전부 과목별(과목칩으로 1개 선택·전환). 기본뷰 = 요일그룹밴드(교시×강사요일, 학생명단, 드래그 편집).
// 통합뷰 = 반=단위 반응형 카드 그리드(반 카드: 헤더·학생명단·정원, 읽기전용 — 한눈에 반 단위로 본다).
// 강사뷰 = 기본뷰와 같은 격자를 **슬롯 강사**(slot_teacher_label) 기준으로 재구성(시트 강사별 배치 패리티,
// 읽기전용) — 영어처럼 한 반을 (요일,교시)마다 다른 강사가 가르치는 과목용. 칩은 english에서만 노출.
// 과목 키·순서·라벨·색은 전부 학원설정(operations.subjects) 단일 소스(하드코딩 금지).

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: ViewMode; subject?: string; week?: string }>;
}) {
  const user = await requireAccess("timetable");
  const { view: viewParam, subject: subjectParam, week: weekRaw } = await searchParams;
  const view: ViewMode =
    viewParam === "integrated" ? "integrated" : viewParam === "teacher" ? "teacher" : "basic";

  // 주간 이동(타임머신) — week 파라미터(그 주 아무 날)를 월요일로 정규화. 미지정=이번 주.
  // 기준 '오늘'은 KST(서버 UTC라 새벽 시간대 하루 밀림 방지). week.ts 내부 날짜 산술은 UTC 결정적 유지.
  const today = kstToday();
  const thisWk = thisMonday(today);
  const week = weekRaw && /^\d{4}-\d{2}-\d{2}$/.test(weekRaw) ? mondayOf(weekRaw) : thisWk;
  // 그 시점 명단 재구성 기준일 = ijw getWeekReferenceDate(미래주→월/이번주→오늘/과거주→일).
  const referenceDate = getWeekReferenceDate(week, today);
  const rel = weekRelation(week, today);
  const isFutureWeek = rel === "future";
  // 편집 = 이번 주(즉시 이동) 또는 미래 주(그 주에 예약). 과거 주는 조회 전용(소급 금지).
  const canEdit = rel !== "past";
  // 이동 적용일 — 미래 주면 그 주 월요일에 예약, 이번 주면 오늘 즉시(undefined→RPC current_date).
  const effectiveDate = isFutureWeek ? week : undefined;

  // 강사는 본인 담당 반만(intra-tenant PII 누수 차단). master/직원은 전체.
  const teacherId = user.systemRole === "teacher" ? user.id : undefined;
  // '시트' 버튼 = master + 구글 시트 내보내기 연동 ON일 때만(비-master는 조회도 생략).
  // '시트 열기'는 대상 시트(spreadsheetId)가 설정돼 있으면 노출 → 상태(enabled+spreadsheetId)를 함께 받는다.
  const [allSlots, settings, sheetsStatus, teacherColors] = await Promise.all([
    getWeeklyScheduleWithStudents({ referenceDate, teacherId }),
    getTenantSettings(),
    user.systemRole === "master" ? getGoogleSheetsStatus() : Promise.resolve(null),
    // 강사색 맵은 통합뷰(셀·담임색)·강사뷰(헤더색)에서만 필요. 기본뷰는 생략.
    view !== "basic" ? getTeacherColorMap() : Promise.resolve({} as TeacherColorMap),
  ]);
  const canSync = user.systemRole === "master" && sheetsStatus?.enabled === true;
  // 구글 시트 URL — 대상 시트가 설정돼 있을 때만(master 한정, 위 조회가 master만 수행).
  const sheetUrl = sheetsStatus?.spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${sheetsStatus.spreadsheetId}/edit`
    : null;
  // 교시 시각 = owner 설정(operations.weekdayPeriods/weekendPeriods) → PeriodsConfig. 미설정 시 기본 상수.
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  // 과목 칩 = 학원설정 과목 순서 ∩ 데이터에 실제 존재하는 과목(빈 과목칩 방지). 무조건 한 과목.
  const available = subjectMaps.options
    .map((o) => o.value)
    .filter((k) => allSlots.some((s) => s.subject === k));
  const defaultSubject = available[0] ?? "";
  const subject =
    subjectParam && available.includes(subjectParam) ? subjectParam : defaultSubject;
  // 평일/주말은 WeekdayGroupTables가 알아서 분리 렌더(주말은 시작시각이 달라 별도 판). 여기선 과목만 필터.
  const slots = allSlots.filter((s) => s.subject === subject);
  // 과목별 요일 병합 프리셋(설정) — 미설정/구데이터는 mon-thu 폴백(resolve가 스키마 미통과).
  const weekdayGrouping = normalizeWeekdayGrouping(
    settings.operations.subjects.find((s) => s.key === subject)?.weekdayGrouping,
  );

  const isIntegrated = view === "integrated";
  // 상단 명단 요약(ijw식 재원/신입/전입/퇴원) — 그 주 시점(타임머신) 기준. 학생이 여러 반에 걸쳐 있어
  // studentId로 유일 집계(중복 제거). 상태 우선순위 재원>대기>퇴원(한 반 재원·다른 반 퇴원이면 재원).
  const statusOf = new Map<string, "active" | "hold" | "withdrawn">();
  const newIds = new Set<string>();
  const transferIds = new Set<string>();
  const sRank = (s: "active" | "hold" | "withdrawn") => (s === "active" ? 0 : s === "hold" ? 1 : 2);
  for (const sl of slots) {
    for (const st of sl.students) {
      const prev = statusOf.get(st.studentId);
      if (prev === undefined || sRank(st.status) < sRank(prev)) statusOf.set(st.studentId, st.status);
      if (st.isNew) newIds.add(st.studentId);
      if (st.isTransferredIn) transferIds.add(st.studentId);
    }
  }
  let enrolledCount = 0;
  let holdCount = 0;
  let withdrawnCount = 0;
  for (const s of statusOf.values()) {
    if (s === "active") enrolledCount++;
    else if (s === "hold") holdCount++;
    else withdrawnCount++;
  }
  // 신입·전입은 재원(active) 학생만 카운트(퇴원자의 옛 플래그 제외).
  const newCount = [...newIds].filter((id) => statusOf.get(id) === "active").length;
  const transferCount = [...transferIds].filter((id) => statusOf.get(id) === "active").length;

  return (
    <TimetableEditProvider effectiveDate={effectiveDate} today={today}>
      <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Toolbar */}
      <div className="bg-card border-line shadow-card flex shrink-0 flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
        {/* 주간 이동(타임머신) — 과거/미래 주의 반 구성 조회 */}
        <WeekNav
          currentWeek={week}
          today={today}
          hrefForWeek={(monday) => buildHref({ view, subject, defaultSubject, week: monday, thisWk })}
        />
        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 과목 chip — 전 뷰 과목별(클릭 = 과목 전환). 강사뷰는 english 전용이라 타과목 전환 시 기본뷰로. */}
        <div className="flex items-center gap-1">
          <span className="micro mr-1">과목</span>
          {available.map((k) => (
            <Link
              key={k}
              href={buildHref({
                view: view === "teacher" && k !== "english" ? "basic" : view,
                subject: k,
                defaultSubject,
                week,
                thisWk,
              })}
              className={`shrink-0 rounded-md border px-2 py-0.5 text-xs transition ${
                subject === k
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {subjectMaps.labelOf(k)}
            </Link>
          ))}
        </div>
        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 뷰 토글 — 강사뷰는 슬롯 강사 데이터가 있는 english에서만 노출(시트 강사별 배치 패리티). */}
        <div className="flex items-center gap-1">
          <span className="micro mr-1">뷰</span>
          {([
            { key: "basic", label: "기본뷰", icon: Columns3 },
            { key: "integrated", label: "통합뷰", icon: LayoutGrid },
            ...(subject === "english"
              ? [{ key: "teacher" as ViewMode, label: "강사뷰", icon: Users }]
              : []),
          ] as { key: ViewMode; label: string; icon: LucideIcon }[]).map((v) => {
            const Icon = v.icon;
            return (
              <Link
                key={v.key}
                href={buildHref({ view: v.key, subject, defaultSubject, week, thisWk })}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition ${
                  view === v.key
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                <Icon size={11} strokeWidth={2} />
                {v.label}
              </Link>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2 font-mono text-[11px] whitespace-nowrap">
          <span className="text-[color:var(--primary)]">재원 {enrolledCount}</span>
          {newCount > 0 ? <span className="text-[color:var(--danger)]">신입 {newCount}</span> : null}
          {transferCount > 0 ? <span className="text-[color:var(--blue)]">전입 {transferCount}</span> : null}
          {holdCount > 0 ? <span className="text-[color:var(--amber)]">대기 {holdCount}</span> : null}
          {withdrawnCount > 0 ? <span className="text-[color:var(--text-faint)]">퇴원 {withdrawnCount}</span> : null}
        </div>

        {/* 편집 컨트롤 — 기본뷰 + 이번/미래 주(통합뷰·강사뷰=읽기전용, 과거=조회 전용).
            미래 주 편집은 그 주에 이동 예약(Phase B). */}
        {view === "basic" && slots.length > 0 && canEdit ? (
          <>
            <span className="bg-line h-4 w-px" aria-hidden />
            <TimetableEditControls />
            {isFutureWeek ? (
              <span className="text-blue text-[11px] whitespace-nowrap">· 이 주에 이동 예약</span>
            ) : null}
          </>
        ) : null}

        <TimetableToolbarActions subject={subject} canSync={canSync} sheetUrl={sheetUrl} />
      </div>

      {slots.length === 0 ? (
        <EmptyState
          icon={() => <CalendarOff size={32} strokeWidth={1.5} />}
          title="해당 과목의 시간표가 없습니다"
        />
      ) : isIntegrated ? (
        <RichGridView slots={slots} subjectMaps={subjectMaps} config={periodsConfig} teacherColors={teacherColors} />
      ) : view === "teacher" ? (
        // 강사뷰 — 시트 "강사별영어시간표" 그대로(강사=세로 블록, 그 안 월~토, 셀=반명+방). 읽기전용, 반 클릭=학생 명단.
        <div className="flex min-h-0 flex-1 flex-col">
          <TeacherGridView slots={slots} weekMonday={week} teacherColors={teacherColors} />
        </div>
      ) : (
        <TimetableDndArea>
          <div className="flex min-h-0 flex-1 flex-col">
            <WeekdayGroupTables
              slots={slots}
              config={periodsConfig}
              weekMonday={week}
              weekdayGrouping={weekdayGrouping}
            />
          </div>
        </TimetableDndArea>
      )}
      </div>
    </TimetableEditProvider>
  );
}

function buildHref(opts: {
  view: ViewMode;
  subject: string;
  defaultSubject: string;
  week: string; // 월요일 YYYY-MM-DD
  thisWk: string; // 이번 주 월요일(기본값이면 생략)
}): string {
  const params = new URLSearchParams();
  if (opts.view !== "basic") params.set("view", opts.view);
  if (opts.subject !== opts.defaultSubject) params.set("subject", opts.subject);
  if (opts.week !== opts.thisWk) params.set("week", opts.week);
  const q = params.toString();
  return q ? `/timetable?${q}` : "/timetable";
}

