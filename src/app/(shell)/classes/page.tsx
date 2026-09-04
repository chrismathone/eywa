import { BookOpen, Users, UserCheck, SearchX } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { EditingBadge } from "@/features/presence/editing-badge";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill } from "@/components/atoms/pill";
import { BigStat } from "@/components/atoms/big-stat";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { requireAccess } from "@/lib/auth/require-access";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import {
  getClassesPage,
  getClassesStats,
  getClassTeacherFilterOptions,
  type ClassListRow,
  type ClassDaySlot,
  type ClassSort,
} from "@/features/classes/server/queries";
import { Pagination } from "@/components/pagination";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps, SUBJECT_SOLID, type SubjectMaps } from "@/features/owner/subjects";
import Link from "next/link";
import { NewClassTrigger } from "./_components/new-class-trigger";
import { ClassroomAssignButton } from "./_components/classroom-assign-dialog";
import { ClassFilterBar } from "./_components/class-filter-bar";
import {
  buildClassHref,
  DAY_KEYS,
  parseClassStatus,
  type ClassFilterState,
  type ViewMode,
} from "./_components/filter-shared";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { sheetDowLabel, sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";

export async function generateMetadata() {
  return { title: `${sheetT(await getTeacherViewLang(), "cls.title")} — eywa` };
}

const PAGE_SIZE = 50;

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{
    subject?: string;
    teacher?: string;
    days?: string;
    q?: string;
    view?: ViewMode;
    sort?: string;
    status?: string;
    page?: string;
  }>;
}) {
  const user = await requireAccess("classes");
  // 반 생성·강의실 자동배정은 **학원 전체를 바꾸는 작업**이라 관리자만(원장 지시 2026-08-06 "강사에게
  // 강의실 자동배정·새 반은 필요없음"). 서버 액션도 같은 게이트(requireClassManage) — 여기 숨김은 표시일 뿐.
  const canManageClasses = await canManageTenant(user.systemRole, "classes");
  const sp = await searchParams;
  const subject = sp.subject ?? "all";
  const teacherId = sp.teacher ?? "all";
  // 다중 요일(콤마구분) — 알 수 없는 키는 버려 안전화.
  const days = (sp.days ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => DAY_KEYS.has(d));
  const q = sp.q ?? "";
  const view: ViewMode = sp.view === "cards" ? "cards" : "table";
  const sort: ClassSort =
    sp.sort === "students" || sp.sort === "teacher" ? sp.sort : "name";
  // 상태 — **미지정이면 '운영'**(원장 2026-08-27 "디폴트로 폐지나 종강된 수업은 안보이고").
  // 판정은 filter-shared 단일 소스라 필터바가 만드는 URL과 여기 해석이 갈리지 않는다.
  const status = parseClassStatus(sp.status);
  const page = Math.max(1, Number(sp.page) || 1);

  // 강사 스코프(내 수업)면 `getClassesPage`가 teacher_id를 **강제**해 전 행이 내 반이다 → 강사 필터·담임 열은
  // 고를 수도 볼 것도 없다(원장 2026-08-20: "강사가 당연히 나일텐데 다른 강사 선택도 보임").
  // ⚠️ 위임(delegation)은 진입 자격만 열 뿐 classIds를 넓히지 않으므로 남의 이름이 섞일 여지도 없다.
  const scopedTeacherId = await effectiveTeacherId();
  const lang = await getTeacherViewLang();
  const [{ rows: classes, total }, teachers, stats, settings] = await Promise.all([
    getClassesPage({ subject, teacherId, days, q, sort, status }, page, PAGE_SIZE),
    // 스코프에선 조회 자체를 건너뛴다(고를 수 없는 목록이라 왕복 낭비).
    scopedTeacherId ? [] : getClassTeacherFilterOptions(), // 필터 전용 — 배정용과 다르다(admin·퇴직 담임도 포함)
    getClassesStats(),
    getTenantSettings(),
  ]);

  // 과목 라벨·색·필터 옵션은 학원설정(operations.subjects) 단일 소스 — 미등록 과목은 드롭다운에 안 뜸.
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const totalSeats = stats.totalSeats;
  const active = stats.active;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current: ClassFilterState = { subject, teacher: teacherId, days, q, view, sort, status };

  const pageHref = (p: number) => {
    const base = new URLSearchParams(buildClassHref(current, {}).split("?")[1] ?? "");
    if (p > 1) base.set("page", String(p));
    const s = base.toString();
    return s ? `/classes?${s}` : "/classes";
  };

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격도 좁힌다 — 제목을 접어도 5단 여백(20px×N)이
    // 그대로면 절약분이 여백으로 되돌아간다(원장 지시 2026-08-06 "너무 남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      {/* Editorial 문법 ① — eyebrow→헤드라인→서브 + 우측 액션(강의실 배정·신규 반).
          ⚠️ 동기화 배지도 **이 행 안**에 둔다 — 따로 두면 배지 하나가 한 줄을 통째로 먹는다(우측이 텅 빈 채로). */}
      <PageHeader
        eyebrow={sheetT(lang, "cls.eyebrow")}
        title={sheetT(lang, "cls.title")}
        description={sheetTf(lang, "cls.desc", { active, seats: totalSeats })}
        actions={
          <>
            <MakeeduSyncBadge domain="classes" />
            {canManageClasses ? (
              <>
                <ClassroomAssignButton />
                <NewClassTrigger />
              </>
            ) : null}
          </>
        }
      />
      {/* Stat strip — Editorial 문법 ②(BigStat). "운영 중"은 보존 대상 EyIcon `check` 유지. */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <BigStat label={sheetT(lang, "cls.stat.total")} value={stats.total} unit={sheetT(lang, "cls.unit.class")} tone="primary" icon={<BookOpen size={16} strokeWidth={1.8} />} />
        <BigStat label={sheetT(lang, "cls.stat.active")} value={active} unit={sheetT(lang, "cls.unit.class")} tone="primary" icon={<EyIcon name="check" size={16} />} />
        <BigStat label={sheetT(lang, "cls.stat.seats")} value={totalSeats} unit={sheetT(lang, "cls.unit.people")} tone="blue" icon={<Users size={16} strokeWidth={1.8} />} />
        <BigStat
          label={sheetT(lang, "cls.stat.avg")}
          value={stats.total > 0 ? Math.round(totalSeats / stats.total) : 0}
          unit={sheetT(lang, "cls.unit.people")}
          tone="gold"
          icon={<UserCheck size={16} strokeWidth={1.8} />}
        />
      </section>

      {/* 과목·요일·강사·정렬 드롭다운 + 검색/뷰 — 선택값 localStorage 영속(클라이언트) */}
      <ClassFilterBar
        current={current}
        teachers={teachers}
        subjectFilters={subjects.filters}
        hideTeacherFilter={scopedTeacherId !== null}
      />

      {/* 결과 카운트 — 액션은 PageHeader 우측으로 이동(문법 ①), 여기는 맥락 라인만.
          컴팩트에선 위 필터 바에 바짝 붙여(-mt) 한 줄을 새로 만들지 않는다. */}
      <p className="text-text-dim px-1 text-[13px] compact-chrome:-mt-1.5">
        {sheetT(lang, "cls.count.pre")}
        <span className="text-foreground font-bold">{total}</span>
        {sheetT(lang, "cls.count.post")}
        {totalPages > 1 ? (
          <span className="ml-2">{sheetTf(lang, "cls.count.pages", { page, total: totalPages })}</span>
        ) : null}
        {q ? <span className="ml-2">{sheetTf(lang, "cls.count.q", { q })}</span> : null}
      </p>

      {total === 0 ? (
        <EmptyState
          image="classes"
          icon={() => <SearchX size={32} strokeWidth={1.8} />}
          title={sheetT(lang, "cls.empty.title")}
          // 기본 필터가 숨긴 것일 수 있다 — "왜 그 반이 없지?"의 답을 여기서 준다(폐지 42 · 종강 5 실재).
          description={status === "all" ? undefined : sheetT(lang, "cls.empty.desc")}
          action={
            status === "all" ? undefined : (
              <Link
                href={buildClassHref(current, { status: "all" })}
                className="border-line text-foreground hover:bg-bg-soft inline-flex items-center rounded-lg border px-3 py-1.5 text-[13px] font-medium"
              >
                {sheetT(lang, "cls.empty.showAll")}
              </Link>
            )
          }
        />
      ) : (
        <>
          {view === "table" ? (
            <TableView classes={classes} subjects={subjects} showTeacher={!scopedTeacherId} lang={lang} />
          ) : (
            <CardsView classes={classes} subjects={subjects} showTeacher={!scopedTeacherId} lang={lang} />
          )}
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} lang={lang} />
        </>
      )}
    </div>
  );
}

/**
 * 운영 요일 칩 + 시작시각. 모든 요일이 같은 시각이면 시각 1개만(월·수·금 14:30),
 * 요일마다 다르면 요일별로(월14:30 목16:20). 시각 정보가 목록에서 사라지던 격차 보강.
 */
function DayChips({
  days,
  barClass,
  stale = false,
  lang,
}: {
  days: ClassDaySlot[];
  barClass: string;
  lang: SheetLang;
  /**
   * 지금 유효하지 않은 배치(운영 기간이 끝났거나 시작 전) — 흐리게 + 이유를 툴팁으로.
   * 🔴 진하게 그리면 "종료일을 넣었는데도 월~금 운영 중"으로 보인다([[#88]], 실측 7반).
   */
  stale?: boolean;
}) {
  if (days.length === 0) return <span className="text-text-faint text-xs">—</span>;
  const starts = days.map((d) => d.start).filter((s): s is string => !!s);
  const uniform = starts.length === days.length && new Set(starts).size === 1;
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
      {...(stale ? { title: sheetT(lang, "cls.staleTitle") } : {})}
    >
      <div className={`flex gap-0.5 text-[11px] font-bold ${stale ? "opacity-45" : ""}`}>
        {days.map((d) => (
          <span
            key={d.day}
            /* ⚠️ 영어 요일은 세 글자(`Mon`)라 `size-5`(20px)에 안 들어간다 — 높이만 고정하고
               가로는 `min-w-5 px-1`로 늘린다(한 글자인 한국어는 20px 그대로 = 원형 유지). */
            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 ${
              stale ? "bg-text-faint" : barClass
            } text-white`}
          >
            {sheetDowLabel(d.day, lang)}
          </span>
        ))}
      </div>
      {stale ? <span className="text-text-faint text-[11px]">{sheetT(lang, "cls.stale")}</span> : null}
      {uniform ? (
        <span className="text-text-dim num text-[12px]">{starts[0]}</span>
      ) : starts.length > 0 ? (
        <span className="text-text-faint num text-[11px]">
          {days
            .filter((d) => d.start)
            .map((d) => sheetTf(lang, "cls.dayAt", { dow: sheetDowLabel(d.day, lang), time: d.start ?? "" }))
            .join(" ")}
        </span>
      ) : null}
    </div>
  );
}

function TableView({
  classes,
  subjects,
  showTeacher,
  lang,
}: {
  classes: ClassListRow[];
  subjects: SubjectMaps;
  /** 강사 스코프에선 전 행이 같은 담임(=본인)이라 열을 통째로 감춘다 — 같은 이름 50줄은 정보가 아니다. */
  showTeacher: boolean;
  lang: SheetLang;
}) {
  return (
    <div className="bg-card shadow-card overflow-auto rounded-2xl">
      <table className="w-full text-sm [&_td]:whitespace-nowrap">
        <thead className="border-line border-b [&_th]:whitespace-nowrap">
          <tr>
            <th className="micro px-4 py-3 text-left">{sheetT(lang, "cls.col.subject")}</th>
            <th className="micro px-4 py-3 text-left">{sheetT(lang, "cls.col.name")}</th>
            {showTeacher ? <th className="micro px-4 py-3 text-left">{sheetT(lang, "cls.col.teacher")}</th> : null}
            <th className="micro px-4 py-3 text-left">{sheetT(lang, "cls.col.room")}</th>
            <th className="micro px-4 py-3 text-left">{sheetT(lang, "cls.col.days")}</th>
            <th className="micro px-4 py-3 text-right">{sheetT(lang, "cls.col.students")}</th>
            <th className="micro px-4 py-3 text-left">{sheetT(lang, "cls.col.status")}</th>
            <th className="micro px-4 py-3 text-left">{sheetT(lang, "cls.col.notes")}</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {classes.map((c) => {
            const meta = { label: subjects.labelOf(c.subject), color: subjects.colorOf(c.subject) };
            return (
              <tr key={c.id} className="hover:bg-bg-soft/50">
                <td className="px-4 py-2.5">
                  <Pill color={meta.color}>{meta.label}</Pill>
                </td>
                <td className="px-4 py-2.5">
                  <WindowLink
                    href={`/classes/${c.id}`}
                    title={c.className}
                    className="text-foreground text-[13px] font-bold hover:underline"
                  >
                    {c.className}
                  </WindowLink>
                  <EditingBadge scope={`class:${c.id}`} className="ml-1.5" />
                </td>
                {showTeacher ? (
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {c.teacherName ? (
                        <span className="text-text-dim text-[12px]">{c.teacherName}</span>
                      ) : (
                        <span className="text-text-faint text-xs">{sheetT(lang, "cls.teacherNone")}</span>
                      )}
                    </div>
                  </td>
                ) : null}
                <td className="text-text-dim px-4 py-2.5 text-[12px]">
                  {c.classroomName ?? "—"}
                </td>
                <td className="px-4 py-2.5">
                  <DayChips days={c.days} barClass={SUBJECT_SOLID[meta.color]} stale={c.daysStale} lang={lang} />
                </td>
                <td className="text-foreground num px-4 py-2.5 text-right text-[12px] font-bold">
                  {c.studentCount}
                  {sheetT(lang, "cls.unit.people")}
                </td>
                <td className="px-4 py-2.5">
                  {!c.isActive ? (
                    <Pill color="neutral">{sheetT(lang, "cls.status.retired")}</Pill>
                  ) : c.closedAt ? (
                    <Pill color="amber">{sheetT(lang, "cls.status.ended")}</Pill>
                  ) : (
                    <Pill color="primary" soft={false}>
                      {sheetT(lang, "cls.status.operating")}
                    </Pill>
                  )}
                </td>
                <td className="text-text-dim px-4 py-2.5 text-xs">
                  {c.notes ? (
                    <span className="line-clamp-1" title={c.notes}>
                      {c.notes}
                    </span>
                  ) : (
                    <span className="text-text-faint">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CardsView({
  classes,
  subjects,
  showTeacher,
  lang,
}: {
  classes: ClassListRow[];
  subjects: SubjectMaps;
  /** 테이블 '담임' 열과 같은 이유 — 스코프에선 전 카드가 본인 이름이라 강의실만 남긴다. */
  showTeacher: boolean;
  lang: SheetLang;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {classes.map((c) => {
        const meta = { label: subjects.labelOf(c.subject), color: subjects.colorOf(c.subject) };
        return (
          <WindowLink
            key={c.id}
            href={`/classes/${c.id}`}
            title={c.className}
            className="bg-card shadow-card hover:shadow-card-hover flex flex-col gap-3 rounded-2xl p-5 transition"
          >
            <header className="flex items-center gap-2">
              <Pill color={meta.color}>{meta.label}</Pill>
              {!c.isActive ? (
                <Pill color="neutral">{sheetT(lang, "cls.status.retired")}</Pill>
              ) : c.closedAt ? (
                <Pill color="amber">{sheetT(lang, "cls.status.ended")}</Pill>
              ) : (
                <Pill color="primary" soft={false}>
                  {sheetT(lang, "cls.status.operating")}
                </Pill>
              )}
            </header>
            {/* 구조화 카드(문법 ⑤) — 반 이름 bold + 담임·강의실 dim 서브 + 우측 재원수 */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-foreground flex flex-wrap items-center gap-1.5 text-[17px] font-bold leading-tight">
                  {c.className}
                  <EditingBadge scope={`class:${c.id}`} />
                </h3>
                <p className="text-text-dim mt-1 truncate text-[12.5px]">
                  {showTeacher
                    ? `${c.teacherName ?? sheetT(lang, "cls.card.teacherNone")}${c.classroomName ? ` · ${c.classroomName}` : ""}`
                    : (c.classroomName ?? sheetT(lang, "cls.card.roomNone"))}
                </p>
              </div>
              <p className="shrink-0 text-right">
                <span className="num text-foreground text-[20px] font-bold leading-none">
                  {c.studentCount}
                </span>
                <span className="text-text-dim ml-0.5 text-[12px]">{sheetT(lang, "cls.unit.people")}</span>
                <span className="text-text-faint block text-[11px]">{sheetT(lang, "cls.card.enrolled")}</span>
              </p>
            </div>
            <div className="mt-auto pt-1">
              <DayChips days={c.days} barClass={SUBJECT_SOLID[meta.color]} stale={c.daysStale} lang={lang} />
            </div>
          </WindowLink>
        );
      })}
    </div>
  );
}
