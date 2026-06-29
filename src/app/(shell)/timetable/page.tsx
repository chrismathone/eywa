import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Columns3, LayoutGrid, CalendarOff } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import { getWeeklyScheduleWithStudents, getTeacherColorMap } from "@/features/timetable/server/queries";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import type { TeacherColorMap } from "@/features/timetable/lib/class-grid";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isGoogleSheetsExportEnabled } from "@/features/integrations/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getWeekReferenceDate, mondayOf, thisMonday, weekRelation } from "@/features/timetable/lib/week";
import { RichGridView } from "./_components/rich-grid-view";
import {
  TimetableEditProvider,
  TimetableEditControls,
  TimetableDndArea,
} from "./_components/timetable-board";
import { TimetableToolbarActions } from "./_components/toolbar-actions";
import { WeekNav } from "./_components/week-nav";
import { WeekdayGroupTables } from "./_components/weekday-group-tables";

export const metadata = { title: "시간표 — eywa" };

type ViewMode = "basic" | "integrated";
// 둘 다 과목별(과목칩으로 1개 선택·전환). 기본뷰 = 요일그룹밴드(교시×강사요일, 학생명단, 드래그 편집).
// 통합뷰 = 반=단위 반응형 카드 그리드(반 카드: 헤더·학생명단·정원, 읽기전용 — 한눈에 반 단위로 본다).
// 과목 키·순서·라벨·색은 전부 학원설정(operations.subjects) 단일 소스(하드코딩 금지).

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: ViewMode; subject?: string; week?: string }>;
}) {
  const user = await requireAccess("timetable");
  const { view: viewParam, subject: subjectParam, week: weekRaw } = await searchParams;
  const view: ViewMode = viewParam === "integrated" ? "integrated" : "basic";

  // 주간 이동(타임머신) — week 파라미터(그 주 아무 날)를 월요일로 정규화. 미지정=이번 주.
  const today = new Date().toISOString().slice(0, 10);
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
  const [allSlots, settings, sheetsEnabled, teacherColors] = await Promise.all([
    getWeeklyScheduleWithStudents({ referenceDate, teacherId }),
    getTenantSettings(),
    user.systemRole === "master" ? isGoogleSheetsExportEnabled() : Promise.resolve(false),
    // 강사색 맵은 통합뷰에서만 필요(셀·담임색). 기본뷰는 생략.
    view === "integrated" ? getTeacherColorMap() : Promise.resolve({} as TeacherColorMap),
  ]);
  const canSync = user.systemRole === "master" && sheetsEnabled;
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

  // "N명 등록" = 재원만 합산(대기·퇴원은 셀 섹션으로만 표시 — 등록 인원 부풀림 방지). 두 뷰 다 과목별.
  const isActive = (st: { status?: string }) => (st.status ?? "active") === "active";
  const isIntegrated = view === "integrated";
  const totalStudents = slots.reduce((sum, x) => sum + x.students.filter(isActive).length, 0);

  return (
    <TimetableEditProvider effectiveDate={effectiveDate}>
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

        {/* 과목 chip — 두 뷰 다 과목별(클릭 = 과목 전환) */}
        <div className="flex items-center gap-1">
          <span className="micro mr-1">과목</span>
          {available.map((k) => (
            <Link
              key={k}
              href={buildHref({ view, subject: k, defaultSubject, week, thisWk })}
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

        {/* 뷰 토글 */}
        <div className="flex items-center gap-1">
          <span className="micro mr-1">뷰</span>
          {([
            { key: "basic", label: "기본뷰", icon: Columns3 },
            { key: "integrated", label: "통합뷰", icon: LayoutGrid },
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

        <span className="text-text-faint ml-auto font-mono text-[11px]">
          총 {slots.length}슬롯 · {totalStudents}명 등록
        </span>

        {/* 편집 컨트롤 — 기본뷰 + 이번/미래 주(통합뷰=읽기전용, 과거=조회 전용).
            미래 주 편집은 그 주에 이동 예약(Phase B). */}
        {!isIntegrated && slots.length > 0 && canEdit ? (
          <>
            <span className="bg-line h-4 w-px" aria-hidden />
            <TimetableEditControls />
            {isFutureWeek ? (
              <span className="text-blue text-[11px] whitespace-nowrap">· 이 주에 이동 예약</span>
            ) : null}
          </>
        ) : null}

        <TimetableToolbarActions subject={subject} canSync={canSync} />
      </div>

      {slots.length === 0 ? (
        <EmptyState
          icon={() => <CalendarOff size={32} strokeWidth={1.5} />}
          title="해당 과목의 시간표가 없습니다"
        />
      ) : isIntegrated ? (
        <RichGridView slots={slots} subjectMaps={subjectMaps} config={periodsConfig} teacherColors={teacherColors} />
      ) : (
        <TimetableDndArea>
          <div className="flex min-h-0 flex-1 flex-col">
            <WeekdayGroupTables slots={slots} config={periodsConfig} weekMonday={week} />
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

