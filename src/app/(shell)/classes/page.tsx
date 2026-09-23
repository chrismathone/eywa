import { tipProps } from "@/components/hover-tip/tip";
import Link from "next/link";
import { BookOpen, Users, UserCheck, SearchX } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { EditingBadge } from "@/features/presence/editing-badge";

import { MenuGlyph } from "@/components/icons/menu-glyph";
import { Pill } from "@/components/atoms/pill";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { HeaderFilter } from "@/components/header-filter";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { Pagination } from "@/components/pagination";
import { RememberPrefs } from "@/components/remember-prefs";
import { SearchToggle } from "@/components/search-toggle";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { requireAccess } from "@/lib/auth/require-access";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import {
  getClassesPage,
  getClassesStats,
  getClassTeacherFilterOptions,
  type ClassListRow,
  type ClassDaySlot,
} from "@/features/classes/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps, SUBJECT_SOLID, type SubjectMaps } from "@/features/owner/subjects";
import { loadClassListPrefs, saveClassListPrefs } from "@/features/classes/server/list-prefs";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { sheetDowLabel, sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";
import {
  DEFAULT_CLASS_LIST_PREFS,
  parseClassDays,
  parseClassListPrefs,
  type ClassListPrefs,
} from "@/features/classes/list-prefs";
import {
  CLASS_STATUS_DEFAULT,
  classKindMeta,
  classStatusMeta,
  KIND_FILTERS,
  parseClassKind,
  parseClassSort,
  parseClassStatus,
  parseClassView,
  SORT_OPTIONS,
  STATUS_FILTERS,
  teacherTeaches,
  type ViewMode,
} from "@/features/classes/list-filters";
import { NewClassTrigger } from "./_components/new-class-trigger";
import { ClassroomAssignButton } from "./_components/classroom-assign-dialog";
import { HeaderDayFilter } from "./_components/header-day-filter";

export async function generateMetadata() {
  return { title: `${sheetT(await getTeacherViewLang(), "cls.title")} — aywa` };
}

const PAGE_SIZE = 50;

// 보기(표/카드) — 지시서 §9 "보기 전환은 2차": 세그먼트 칩 대신 라벨 하나(`보기: 표`). 값은 계정 보기 설정에 남는다.
const VIEW_OPTION_KEYS = [{ value: "cards" as ViewMode, key: "cls.view.cards" as const }];

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    subject?: string;
    teacher?: string;
    days?: string;
    q?: string;
    view?: string;
    sort?: string;
    status?: string;
    page?: string;
  }>;
}) {
  const user = await requireAccess("classes");
  const sp = await searchParams;
  // 반 생성·강의실 자동배정은 **학원 전체를 바꾸는 작업**이라 관리자만(원장 지시 2026-08-06 "강사에게
  // 강의실 자동배정·새 반은 필요없음"). 서버 액션도 같은 게이트(requireClassManage) — 여기 숨김은 표시일 뿐.
  // 강사 스코프(내 수업)면 `getClassesPage`가 teacher_id를 **강제**해 전 행이 내 반이다 → 강사 필터·담임 열은
  // 고를 수도 볼 것도 없다(원장 2026-08-20: "강사가 당연히 나일텐데 다른 강사 선택도 보임").
  // 보기 설정은 계정 귀속(users.ui_prefs.classes, 원장 2026-08-04) — URL(명시값) → 저장값 → 기본값.
  const [canManageClasses, scopedTeacherId, prefsLoaded, lang] = await Promise.all([
    canManageTenant(user.systemRole, "classes"),
    effectiveTeacherId(),
    loadClassListPrefs(),
    // 화면 언어(강사 미니셸) — 관리자 풀셸은 항상 한국어라 값이 "ko"다(i18n.ts 기본값).
    getTeacherViewLang(),
  ]);
  // 조회 실패(null)면 기본값으로 그리되 **이번 렌더는 저장하지 않는다** — 기본값을 저장값으로 알고 전체를 보내면 다른 축이 지워진다(리뷰 2026-09-04).
  const prefs = prefsLoaded ?? DEFAULT_CLASS_LIST_PREFS;
  // 상태 — **미지정이면 '운영'**(원장 2026-08-27 "디폴트로 폐지나 종강된 수업은 안보이고"). 🔴 상태·검색어는 저장하지 않는다.
  const status = parseClassStatus(sp.status);
  const q = sp.q ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  // 구분(정규/특강) — 과목과 같은 결의 보기 필터(계정 저장). 선택지가 고정 셋이라 저장값 검증이 따로 필요 없다(파서가 접는다).
  const kind = parseClassKind(sp.kind ?? prefs.kind);
  const subjectRaw = sp.subject ?? prefs.subject;
  const teacherRaw = sp.teacher ?? prefs.teacher;
  // 요일(다중, 콤마구분) — `days=all`은 파서가 빈 배열로 접는다(전체를 URL에 **명시**하는 값, HeaderDayFilter 주석).
  const days = sp.days !== undefined ? parseClassDays(sp.days) : prefs.days;
  const sort = parseClassSort(sp.sort ?? prefs.sort);
  const view = parseClassView(sp.view ?? prefs.view);

  const settingsPromise = getTenantSettings();
  // 스코프에선 조회 자체를 건너뛴다(고를 수 없는 목록이라 왕복 낭비). 필터 전용 — 배정용과 다르다(admin·퇴직 담임도 포함).
  const teachersPromise: Promise<{ id: string; name: string; subjects: string[] }[]> = scopedTeacherId
    ? Promise.resolve([])
    : getClassTeacherFilterOptions();
  // 통계는 지금 띄워 두고 맨 끝에 받는다 — 아래 저장값 검증이 기다리는 건 선택지 둘뿐(B4). 그 사이 거절은 표식만(값은 끝에서).
  const statsPromise = getClassesStats();
  void statsPromise.catch(() => undefined);
  const optionsPromise = Promise.all([teachersPromise, settingsPromise]);
  // 저장값(URL이 아니라 계정 설정에서 온 값)은 **지금 선택지에 있을 때만** 쓴다 — 흡수된 과목·퇴사한 담임이 보이지 않는 필터로
  // 남아 결과를 0개로 만들지 않게(학생목록과 같은 규약). URL로 고른 값은 그대로 믿는다(그 경우 목록 조회가 설정을 기다리지 않는다).
  let subject = subjectRaw;
  let teacherId = teacherRaw;
  /** 담임이 그 과목을 안 가르쳐 **풀었다** — 옛 필터바처럼 URL·저장값에서도 담임을 전체로 본다(안 그러면 유령 담임이 남아 과목을 되돌리면 다시 붙는다). */
  let teacherReset = false;
  const fromPrefs = (key: "subject" | "teacher") => sp[key] === undefined;
  // 🔴 담임이 그 과목을 안 가르치면 담임 필터를 **푼다** — 옛 필터바는 과목을 고르는 순간 클라에서 되돌렸는데(onSubject), 열 머리는
  //    축마다 따로 이동하므로 서버가 같은 판정을 한다(적대적 리뷰 2026-09-04: 안 풀면 결과 0개인데 빈 상태는 상태 탓이라 말하고, 그 조합이
  //    계정에 저장돼 맨몸 방문마다 0개였다). 판정엔 담임 목록(과목 포함)이 필요해 둘 다 걸린 경우만 선택지를 먼저 기다린다.
  const needTeacherCheck = !scopedTeacherId && teacherRaw !== "all" && subjectRaw !== "all";
  if (
    (fromPrefs("subject") && subjectRaw !== "all") ||
    (fromPrefs("teacher") && teacherRaw !== "all" && !scopedTeacherId) ||
    needTeacherCheck
  ) {
    const [teachersEarly, settingsEarly] = await optionsPromise;
    if (fromPrefs("subject") && !settingsEarly.operations.subjects.some((s) => s.key === subjectRaw)) subject = "all";
    if (fromPrefs("teacher") && !scopedTeacherId && !teachersEarly.some((t) => t.id === teacherRaw)) teacherId = "all";
    if (needTeacherCheck && subject !== "all" && teacherId !== "all") {
      const picked = teachersEarly.find((t) => t.id === teacherId);
      if (picked && !teacherTeaches(picked.subjects, subject)) {
        teacherId = "all";
        teacherReset = true;
      }
    }
  }

  const [{ rows: classes, total }, stats, [teachers, settings]] = await Promise.all([
    getClassesPage({ kind, subject, teacherId, days, q, sort, status }, page, PAGE_SIZE),
    statsPromise,
    optionsPromise,
  ]);

  // 과목 라벨·색·필터 옵션은 학원설정(operations.subjects) 단일 소스 — 미등록 과목은 드롭다운에 안 뜸.
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const subjectOptions = subjects.filters.filter((f) => f.value !== "all");
  // 담임 선택지 — 현재 과목 담당만(전체면 전부). 선택 담임이 목록 밖이면(직접 URL) 앞에 보강해 라벨을 유지한다.
  const visibleTeachers = subject === "all" ? teachers : teachers.filter((t) => teacherTeaches(t.subjects, subject));
  const selectedTeacher = teacherId === "all" ? null : teachers.find((t) => t.id === teacherId);
  const teacherOptions = visibleTeachers.map((t) => ({ value: t.id, label: t.name }));
  if (selectedTeacher && !visibleTeachers.some((t) => t.id === selectedTeacher.id)) {
    teacherOptions.unshift({ value: selectedTeacher.id, label: selectedTeacher.name });
  }
  const showTeacher = !scopedTeacherId;
  const totalSeats = stats.totalSeats;
  const active = stats.active;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 저장할 보기 설정 — 🔴 **사용자가 고른 값(URL) 또는 이미 저장된 값**만(선택지 밖 보정은 이 화면 한정, 계정에 안 쓴다).
  // 🔑 저장값과 **같은 파서**를 지난다(`?subject=` 같은 빈 값을 원문 그대로 두면 저장값과 영영 달라 렌더마다 저장한다).
  const current: ClassListPrefs = parseClassListPrefs({
    // 모르는 값(옛 링크)은 보여 주기만 기본값 — 저장값은 건드리지 않는다(아래 정렬·보기와 같은 규약).
    kind: sp.kind === undefined || parseClassKind(sp.kind) === sp.kind ? kind : prefs.kind,
    subject: sp.subject ?? prefs.subject,
    teacher: teacherReset ? "all" : (sp.teacher ?? prefs.teacher),
    days,
    // URL 값이 선택지 밖(옛 링크의 모르는 정렬·보기)이면 기본값으로 **보여 주기만** 하고 저장값은 건드리지 않는다(리뷰 2026-09-04).
    sort: sp.sort === undefined || parseClassSort(sp.sort) === sp.sort ? sort : prefs.sort,
    view: sp.view === undefined || parseClassView(sp.view) === sp.view ? view : prefs.view,
  });

  /**
   * 목록 링크(쪽 넘김·보기 전환·빈 상태의 '전체 상태로 보기')가 들고 갈 파라미터 — 기본값과 다르거나 **URL이 명시한** 축은
   * 그대로 적는다. ⚠️ URL이 적은 값은 **적힌 그대로** 잇는다(보정값이 아니라) — 보정값을 링크에 실으면 다음 렌더가 그것을
   * 사용자 선택으로 읽어 계정에 저장한다(학생목록 재리뷰 2026-09-03).
   */
  const listParams = (patch: { page?: number; status?: string } = {}) => {
    const params = new URLSearchParams();
    const st = patch.status ?? status;
    if (st !== CLASS_STATUS_DEFAULT) params.set("status", st);
    if (sp.kind !== undefined) params.set("kind", sp.kind);
    else if (kind !== "all") params.set("kind", kind);
    if (sp.subject !== undefined) params.set("subject", sp.subject);
    else if (subject !== "all") params.set("subject", subject);
    if (teacherReset) params.set("teacher", "all"); // 푼 담임은 링크에서도 전체(옛 필터바의 URL 되돌림과 같은 뜻)
    else if (sp.teacher !== undefined) params.set("teacher", sp.teacher);
    else if (teacherId !== "all") params.set("teacher", teacherId);
    if (sp.days !== undefined) params.set("days", sp.days);
    else if (days.length) params.set("days", days.join(","));
    if (sp.sort !== undefined) params.set("sort", sp.sort);
    else if (sort !== "name") params.set("sort", sort);
    if (sp.view !== undefined) params.set("view", sp.view);
    else if (view !== "table") params.set("view", view);
    if (q) params.set("q", q);
    if ((patch.page ?? 1) > 1) params.set("page", String(patch.page));
    const s = params.toString();
    return s ? `/classes?${s}` : "/classes";
  };
  const pageHref = (p: number) => listParams({ page: p });
  // 엑셀(감사 N2) — 엑셀 API는 계정 보기 설정을 모른다. **이 화면이 실제로 건 값**(보정 후)을 그대로 넘겨 파일 행 = 목록 행.
  const exportHref = `/api/exports/classes?${new URLSearchParams({
    ...(kind !== "all" ? { kind } : {}),
    ...(subject !== "all" ? { subject } : {}),
    ...(teacherId !== "all" ? { teacher: teacherId } : {}),
    ...(days.length ? { days: days.join(",") } : {}),
    ...(q ? { q } : {}),
    ...(sort !== "name" ? { sort } : {}),
    // 상태는 **항상** 적는다 — 빠지면 라우트가 기본값(운영)으로 읽어 '전체'를 고른 화면과 파일이 갈린다.
    status,
  }).toString()}`;

  // 열 머리 필터 한 벌 — 표 보기는 `<th>` 안에, 카드 보기는 격자 위 머리 줄에 **같은 것**이 선다(필터 코드를 두 벌 두지 않는다).
  const head = {
    kind: (
      <HeaderFilter
        paramName="kind"
        value={kind}
        options={KIND_FILTERS.map((o) => ({ value: o.value, label: sheetT(lang, o.key) }))}
        axisLabel={sheetT(lang, "cls.col.kind")}
        allValue="all"
        explicitAll
      />
    ),
    subject: (
      <HeaderFilter paramName="subject" value={subject} options={subjectOptions} axisLabel={sheetT(lang, "cls.filter.subject")} allValue="all" explicitAll />
    ),
    sort: (
      <HeaderFilter
        paramName="sort"
        value={sort}
        options={SORT_OPTIONS.filter((o) => o.value !== "name" && (showTeacher || o.value !== "teacher" || sort === "teacher")).map((o) => ({
          value: o.value,
          label: sheetT(lang, o.key),
        }))}
        axisLabel={sheetT(lang, "cls.filter.sort")}
        allValue="name"
        allLabel={sheetT(lang, "cls.sort.name")}
        explicitAll
        showAll
      />
    ),
    teacher: <HeaderFilter paramName="teacher" value={teacherId} options={teacherOptions} axisLabel={sheetT(lang, "cls.col.teacher")} allValue="all" explicitAll cap={200} />,
    days: <HeaderDayFilter value={days} />,
    // 기본값(운영)이 종강·폐지를 **숨기므로** 값을 항상 적는다(showAll). 저장하지 않는 축이라 explicitAll은 아니다(기본은 파라미터 없음).
    status: (
      <HeaderFilter
        paramName="status"
        value={status}
        options={STATUS_FILTERS.filter((o) => o.value !== CLASS_STATUS_DEFAULT).map((o) => ({ value: o.value, label: sheetT(lang, o.key) }))}
        axisLabel={sheetT(lang, "cls.filter.status")}
        allValue={CLASS_STATUS_DEFAULT}
        allLabel={sheetT(lang, "cls.status.operating")}
        showAll
      />
    ),
  };

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격도 좁힌다(원장 지시 2026-08-06 "너무 남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      {prefsLoaded ? <RememberPrefs current={current} saved={prefsLoaded} save={saveClassListPrefs} /> : null}
      {/* 머리 — 지시서 §10: 상시 버튼은 Primary('새 반') + 텍스트 Secondary('강의실 자동배정') 둘. 설명 줄은 뺐다(바로 아래
          스탯 네 칸이 같은 숫자를 말한다). 동기화 배지는 읽기 전용 표식이라 그대로. */}
      <PageHeader
        eyebrow={sheetT(lang, "cls.eyebrow")}
        title={sheetT(lang, "cls.title")}
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
      {/* Stat strip — Editorial 문법 ②(BigStat). "운영 중"은 정상 = 초록(의미색 캐논). */}
      <StatStrip>
        <BigStat label={sheetT(lang, "cls.stat.total")} value={stats.total} unit={sheetT(lang, "cls.unit.class")} tone="primary" icon={<BookOpen size={16} strokeWidth={1.8} />} />
        <BigStat label={sheetT(lang, "cls.stat.active")} value={active} unit={sheetT(lang, "cls.unit.class")} tone="green" icon={<MenuGlyph name="check" size={22} />} />
        <BigStat label={sheetT(lang, "cls.stat.seats")} value={totalSeats} unit={sheetT(lang, "cls.unit.people")} tone="blue" icon={<Users size={16} strokeWidth={1.8} />} />
        <BigStat
          label={sheetT(lang, "cls.stat.avg")}
          value={stats.total > 0 ? Math.round(totalSeats / stats.total) : 0}
          unit={sheetT(lang, "cls.unit.people")}
          tone="gold"
          icon={<UserCheck size={16} strokeWidth={1.8} />}
        />
      </StatStrip>

      {/* 결과 줄 — 숫자 + 보기(라벨 하나) + 검색(눌러야 나온다). 필터·정렬은 여기 없다 — 아래 **열 머리**가 필터다
          (§10 "필터·정렬은 목록 헤더 라벨을 눌러 호출"). 옛 필터바(드롭다운 6 + 상시 검색 + 세그먼트, localStorage 저장)는 삭제. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
        <p className="text-text-dim text-sm whitespace-nowrap">
          {sheetT(lang, "cls.count.pre")}
          <span className="text-foreground font-bold">{total}</span>
          {sheetT(lang, "cls.count.post")}
          {totalPages > 1 ? (
            <span className="num ml-1.5">
              · {page}/{totalPages}
            </span>
          ) : null}
          {q ? <span className="ml-1.5">· {sheetTf(lang, "cls.count.q", { q })}</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            paramName="view"
            value={view}
            options={VIEW_OPTION_KEYS.map((o) => ({ value: o.value, label: sheetT(lang, o.key) }))}
            allValue="table"
            allLabel={sheetT(lang, "cls.view.table")}
            axisLabel={sheetT(lang, "cls.view")}
            ariaLabel={sheetT(lang, "cls.view")}
            explicitAll
            className="w-auto"
            triggerClassName={TOOLBAR_SELECT}
          />
          <SearchToggle placeholder={sheetT(lang, "cls.filter.searchPh")} defaultValue={q} />
          {/* 화면과 같은 집합을 파일로(감사 N2) — 다운로드라 소프트 이동(Link)이 아니라 맨 `<a>`. */}
          <Button variant="ghost" className="text-primary" render={<a href={exportHref} />}>
            {sheetT(lang, "stu.excel")}
          </Button>
        </div>
      </div>

      {/* 🔴 표는 결과가 0개여도 그린다 — 열 머리가 곧 필터라, 표를 치우면 걸린 필터를 되돌릴 컨트롤이 함께 사라진다
          (학생목록 실브라우저 결함 2026-09-03). 빈 상태는 표 본문 안에 선다. */}
      {view === "table" ? (
        <TableView classes={classes} subjects={subjects} showTeacher={showTeacher} head={head} lang={lang} empty={emptyState(total, status, q, listParams, lang)} />
      ) : (
        <CardsView classes={classes} subjects={subjects} showTeacher={showTeacher} head={head} lang={lang} empty={emptyState(total, status, q, listParams, lang)} />
      )}
      {total > 0 ? <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} /> : null}
    </div>
  );
}

type HeadCells = { kind: React.ReactNode; subject: React.ReactNode; sort: React.ReactNode; teacher: React.ReactNode; days: React.ReactNode; status: React.ReactNode };

/** 빈 상태 — 설명 문장 없이 제목만(§4). 기본 필터(운영)가 숨긴 것일 수 있어 '전체 상태로 보기' 링크 하나(폐지 42 · 종강 5 실재). */
function emptyState(
  total: number,
  status: string,
  q: string,
  listParams: (patch: { status?: string }) => string,
  lang: SheetLang,
): React.ReactNode {
  if (total > 0) return null;
  return (
    <EmptyState
      image="classes"
      icon={() => <SearchX size={32} strokeWidth={1.8} />}
      title={sheetT(lang, "cls.empty.title")}
      action={
        status === "all" ? undefined : (
          // 공용 <Button>(control-scale) — 세로 패딩으로 높이를 만들지 않는다(v5 ②, 리뷰 2026-09-04).
          <Button variant="outline" render={<Link href={listParams({ status: "all" })} />}>
            {sheetT(lang, "cls.empty.showAll")}
          </Button>
        )
      }
    />
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
  center = false,
  lang,
}: {
  days: ClassDaySlot[];
  barClass: string;
  lang: SheetLang;
  /** 표 칸에서 가운데로 — 열 제목(가운데)과 같은 축에 선다. 폰 카드(`phone:`)에선 왼쪽 그대로. */
  center?: boolean;
  /**
   * 지금 유효하지 않은 배치(운영 기간이 끝났거나 시작 전) — 흐리게 + 이유를 툴팁으로.
   * 🔴 진하게 그리면 "종료일을 넣었는데도 월~금 운영 중"으로 보인다([[#88]], 실측 7반).
   */
  stale?: boolean;
}) {
  if (days.length === 0) return <span className="text-text-faint text-sm">—</span>;
  const starts = days.map((d) => d.start).filter((s): s is string => !!s);
  const uniform = starts.length === days.length && new Set(starts).size === 1;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${center ? "justify-center phone:justify-start" : ""}`}
      {...(stale ? { title: sheetT(lang, "cls.staleTitle") } : {})}
    >
      {/* 요일 원 = 글자 14(xs 바닥)에 24px — 종전 20px 원은 글자가 12px이었다(v5: 12px 이하 금지). */}
      <div className={`flex gap-0.5 text-xs font-bold ${stale ? "opacity-45" : ""}`}>
        {days.map((d) => (
          <span
            key={d.day}
            /* ⚠️ 영어 요일은 세 글자(`Mon`)라 `size-5`(20px)에 안 들어간다 — 높이만 고정하고
               가로는 `min-w-5 px-1`로 늘린다(한 글자인 한국어는 20px 그대로 = 원형 유지). */
            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 ${
              stale ? "bg-neutral-fill" : barClass
            } text-white`}
          >
            {sheetDowLabel(d.day, lang)}
          </span>
        ))}
      </div>
      {stale ? <span className="text-text-faint text-sm">{sheetT(lang, "cls.stale")}</span> : null}
      {uniform ? (
        <span className="text-text-dim num text-sm">{starts[0]}</span>
      ) : starts.length > 0 ? (
        <span className="text-text-faint num text-sm">
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
  head,
  empty,
  lang,
}: {
  classes: ClassListRow[];
  subjects: SubjectMaps;
  /** 강사 스코프에선 전 행이 같은 담임(=본인)이라 열을 통째로 감춘다 — 같은 이름 50줄은 정보가 아니다. */
  showTeacher: boolean;
  head: HeadCells;
  empty: React.ReactNode;
  lang: SheetLang;
}) {
  const colCount = showTeacher ? 9 : 8;
  return (
    // 이 메뉴의 최소 창(1100)에 맞춘 고정 열(`table-fixed`)이라 창 안에선 가로 스크롤이 없다. 🔴 폰에서도 `overflow-x-auto` 상자로 싸지
    // 않는다(overflow-y까지 auto가 되어 열 머리 팝업이 잘린다 — 학생목록 주석). 폰(최상위 프레임 <768px)은 `.stack-rows`(globals.css)가
    // 열 머리를 필터 칩 줄로, 행을 [구분 · 과목 | 반 이름 | 상태] / [담임 · 강의실 · 요일 · 인원] / 메모 두세 줄 카드로 접는다(2026-09-13 모바일
    // 전수검사 — 그전엔 표 896px가 본문을 가로로 밀어 담임 뒤 열이 전부 화면 밖이었다). 칸의 자리는 `data-cell`이 정한다.
    // ⚠️ `max-md:min-w-[56rem]`은 **창(iframe) 안을 위해 남긴다**(학생목록 주석과 같은 이유 — 창을 768 아래로 스냅하면 종전대로 가로 스크롤).
    <div className="stack-rows bg-card shadow-card rounded-2xl">
      <table className="w-full table-fixed text-sm max-md:min-w-[56rem]">
        {/* 열 폭 — 최소 창(1050 본문)에서 **값이 걸린 열 머리**가 제 칸에 들어가는 폭(실측 2026-09-18): `상태: 종강 ⌄`(≈112px) 13% ·
            `구분: 특강 ⌄`·`과목: 수학 ⌄`(≈96px) 10%씩(머리 칸 좌우 여백을 `px-1`로 줄여서) — 7%로 두면 34px가 옆 칸으로 넘쳐
            제목이 값보다 23px 오른쪽에 섰다. 🔴 넘친 머리는 가운데 정렬이 안 먹어(넘치면 왼쪽부터 선다) 이 열의 요청 자체가 깨진다.
            요일 20%는 요일마다 시각이 다른 두 요일(`월16:20 목17:00`)이 한 줄에 서는 폭 — 그 몫을 메모(7%, 전문은 마우스 오버)에서 냈다. */}
        <colgroup>
          <col className="w-[10%]" />
          <col className="w-[10%]" />
          <col className={showTeacher ? "w-[18%]" : "w-[26%]"} />
          {showTeacher ? <col className="w-[8%]" /> : null}
          <col className="w-[8%]" />
          <col className="w-[20%]" />
          <col className="w-[6%]" />
          <col className="w-[13%]" />
          <col className="w-[7%]" />
        </colgroup>
        <thead className="border-line border-b">
          {/* 🔴 열 제목과 본문 값은 **같은 축(가운데)**에 선다(원장 2026-09-18 *"행제목과 밑에 내용이 어긋난거 같은데 정렬해주고"*) —
              08-05 표 규약은 "제목만 가운데, 본문은 왼쪽"이었는데 이 표는 칸이 넓어 제목과 값이 서로 다른 자리에 섰다
              (반 이름 제목이 값보다 80px 오른쪽). 폰 카드(`.stack-rows`)는 globals.css가 전부 왼쪽으로 되돌린다. */}
          {/* 앞 두 칸(구분·과목)은 좌우 여백을 줄인다 — `!`로 덮지 말 것(레이어 안 important가 폰 카드의 `padding:0 !important`를 이긴다). */}
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-center [&>th]:font-bold [&>th]:whitespace-nowrap [&>th:nth-child(-n+2)]:px-1">
            <th scope="col">{head.kind}</th>
            <th scope="col">{head.subject}</th>
            <th scope="col">
              <span className="flex flex-wrap items-center justify-center gap-1">
                <span className="px-1" data-cell="label">{sheetT(lang, "cls.col.name")}</span>
                {head.sort}
              </span>
            </th>
            {showTeacher ? <th scope="col">{head.teacher}</th> : null}
            {/* 라벨만 있는 머리는 th 자체에 표식 — 폰 카드에선 열이 없어 열 이름이 뜻을 잃고, span만 감추면 0×0 th가 칩 줄 간격을 먹는다. */}
            <th scope="col" data-cell="label">
              <span className="px-1">{sheetT(lang, "cls.col.room")}</span>
            </th>
            <th scope="col">{head.days}</th>
            <th scope="col" data-cell="label">
              <span className="px-1">{sheetT(lang, "cls.col.students")}</span>
            </th>
            <th scope="col">{head.status}</th>
            <th scope="col" data-cell="label">
              <span className="px-1">{sheetT(lang, "cls.col.notes")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {empty ? (
            <tr>
              <td colSpan={colCount} className="px-3 py-4">
                {empty}
              </td>
            </tr>
          ) : null}
          {classes.map((c) => {
            const meta = { label: subjects.labelOf(c.subject), color: subjects.colorOf(c.subject) };
            const kind = classKindMeta(c);
            const st = classStatusMeta(c);
            return (
              <tr key={c.id} className="hover:bg-bg-soft/50 transition-colors [&>td]:px-3 [&>td]:py-2.5 [&>td]:text-center">
                {/* 구분·과목은 둘 다 앞 알약 — 폰 카드에서도 첫 줄 머리에 나란히 선다(`lead`). */}
                <td data-cell="lead">
                  <Pill color={kind.color}>{sheetT(lang, kind.key)}</Pill>
                </td>
                <td data-cell="lead">
                  <Pill color={meta.color}>{meta.label}</Pill>
                </td>
                <td data-cell="primary">
                  <span className="phone:justify-start flex min-w-0 items-center justify-center gap-1.5">
                    {/* 반 이름은 1차 식별자(18px 굵게) — 좁으면 잘리되 전문은 마우스 오버(title). */}
                    <WindowLink
                      href={`/classes/${c.id}`}
                      title={c.className}
                      className="text-foreground min-w-0 truncate text-base font-bold hover:underline"
                    >
                      {c.className}
                    </WindowLink>
                    <EditingBadge scope={`class:${c.id}`} />
                  </span>
                </td>
                {showTeacher ? (
                  <td className="text-text-dim">
                    <span className="block truncate">{c.teacherName ?? <span className="text-text-faint">{sheetT(lang, "cls.teacherNone")}</span>}</span>
                  </td>
                ) : null}
                {/* 빈 값(`—`)은 폰 카드에서 감춘다(data-empty) — 열 머리 글자가 없는 카드에선 대시가 무엇의 빈칸인지 알 수 없다. */}
                <td className="text-text-dim" data-empty={c.classroomName ? undefined : "true"}>
                  <span className="block truncate">{c.classroomName ?? "—"}</span>
                </td>
                <td data-empty={c.days.length === 0 ? "true" : undefined}>
                  <DayChips days={c.days} barClass={SUBJECT_SOLID[meta.color]} stale={c.daysStale} center lang={lang} />
                </td>
                <td className="text-foreground num font-bold whitespace-nowrap">
                  {c.studentCount}
                  {sheetT(lang, "cls.unit.people")}
                </td>
                <td data-cell="status">
                  <Pill color={st.color}>{sheetT(lang, st.key)}</Pill>
                </td>
                <td className="text-text-dim" data-cell="wide" data-empty={c.notes?.trim() ? undefined : "true"}>
                  {c.notes ? (
                    <span className="line-clamp-1" {...tipProps(c.notes)}>
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
  head,
  empty,
  lang,
}: {
  classes: ClassListRow[];
  subjects: SubjectMaps;
  /** 테이블 '담임' 열과 같은 이유 — 스코프에선 전 카드가 본인 이름이라 강의실만 남긴다. */
  showTeacher: boolean;
  head: HeadCells;
  empty: React.ReactNode;
  lang: SheetLang;
}) {
  return (
    <div className="space-y-3">
      {/* 카드 보기엔 표 머리가 없다 — 같은 열 머리 필터를 격자 위 한 줄에 세운다(필터가 보기마다 다른 자리에 있으면 안 된다). */}
      <div className="text-text-dim flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-sm font-bold">
        {head.kind}
        {head.subject}
        {head.sort}
        {showTeacher ? head.teacher : null}
        {head.days}
        {head.status}
      </div>
      {empty}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {classes.map((c) => {
          const meta = { label: subjects.labelOf(c.subject), color: subjects.colorOf(c.subject) };
          const kind = classKindMeta(c);
          const st = classStatusMeta(c);
          return (
            <WindowLink
              key={c.id}
              href={`/classes/${c.id}`}
              title={c.className}
              className="bg-card shadow-card hover:shadow-card-hover flex flex-col gap-3 rounded-2xl p-5 transition"
            >
              <header className="flex items-center gap-2">
                <Pill color={kind.color}>{sheetT(lang, kind.key)}</Pill>
                <Pill color={meta.color}>{meta.label}</Pill>
                <Pill color={st.color}>{sheetT(lang, st.key)}</Pill>
              </header>
              {/* 구조화 카드(문법 ⑤) — 반 이름 bold + 담임·강의실 dim 서브 + 우측 재원수 */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-foreground flex flex-wrap items-center gap-1.5 text-lg leading-tight font-bold">
                    {c.className}
                    <EditingBadge scope={`class:${c.id}`} />
                  </h3>
                  <p className="text-text-dim mt-1 truncate text-sm">
                    {showTeacher
                      ? `${c.teacherName ?? sheetT(lang, "cls.card.teacherNone")}${c.classroomName ? ` · ${c.classroomName}` : ""}`
                      : (c.classroomName ?? sheetT(lang, "cls.card.roomNone"))}
                  </p>
                </div>
                <p className="shrink-0 text-right">
                  <span className="num text-foreground text-xl leading-none font-bold">{c.studentCount}</span>
                  <span className="text-text-dim ml-0.5 text-sm">{sheetT(lang, "cls.unit.people")}</span>
                  <span className="text-text-faint block text-sm">{sheetT(lang, "cls.card.enrolled")}</span>
                </p>
              </div>
              <div className="mt-auto pt-1">
                <DayChips days={c.days} barClass={SUBJECT_SOLID[meta.color]} stale={c.daysStale} lang={lang} />
              </div>
            </WindowLink>
          );
        })}
      </div>
    </div>
  );
}
