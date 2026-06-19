import Link from "next/link";
import { BookOpen, Users, UserCheck, SearchX, type LucideIcon } from "lucide-react";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getClassesPage,
  getClassesStats,
  getClassTeacherOptions,
  type ClassListRow,
  type ClassDaySlot,
  type ClassSort,
} from "@/features/classes/server/queries";
import { FilterSelect } from "@/components/filter-select";
import { Pagination } from "@/components/pagination";
import { NewClassTrigger } from "./_components/new-class-trigger";

export const metadata = { title: "수업목록 — eywa" };

const PAGE_SIZE = 50;

// "운영 중" Stat은 보존 대상 EyIcon `check`를 유지 — Lucide 시그니처(size·strokeWidth) 어댑터로 감싸 Stat에 전달.
const CheckIcon: LucideIcon = ((props: { size?: number | string }) => (
  <EyIcon name="check" size={typeof props.size === "number" ? props.size : undefined} />
)) as unknown as LucideIcon;

type ViewMode = "cards" | "table";

const SUBJECT_META: Record<string, { label: string; color: PillColor }> = {
  math: { label: "수학", color: "primary" },
  highmath: { label: "수학(심화)", color: "primary" },
  english: { label: "영어", color: "blue" },
  korean: { label: "국어", color: "rose" },
  science: { label: "과학", color: "purple" },
  arts: { label: "예술", color: "amber" },
};

const SUBJECT_BAR: Record<string, string> = {
  math: "bg-primary",
  highmath: "bg-primary",
  english: "bg-blue",
  korean: "bg-rose",
  science: "bg-purple",
  arts: "bg-amber",
};

const DAY_LABEL: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

const SUBJECT_FILTERS = [
  { key: "all", label: "전체" },
  { key: "math", label: "수학" },
  { key: "highmath", label: "수학(심화)" },
  { key: "english", label: "영어" },
  { key: "korean", label: "국어" },
  { key: "science", label: "과학" },
  { key: "arts", label: "예술" },
];

// 강사가 해당 과목을 담당하는지 — users.subjects 대소문자 편차('MATH' vs 'math')에 견고하게(정확일치, 무시).
const teacherTeaches = (subjects: string[], subjectKey: string) =>
  subjects.some((s) => s.toLowerCase() === subjectKey.toLowerCase());

// 요일 칩 — ijw처럼 다중 선택(토글). "전체"는 선택 해제.
const DAY_FILTERS = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
  { key: "sun", label: "일" },
];
const DAY_KEYS = new Set(DAY_FILTERS.map((d) => d.key));

// 정렬 — ijw 패리티(수업명순/학생수순/강사명순). 기본 name은 URL에 안 실음.
const SORT_OPTIONS: { value: Exclude<ClassSort, "name">; label: string }[] = [
  { value: "students", label: "학생수순" },
  { value: "teacher", label: "강사명순" },
];

// 필터 칩 공통 스타일(과목·요일). 활성 = ink 솔리드, 비활성 = 라인 + hover.
const chipCls = (active: boolean) =>
  `shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
    active
      ? "border-foreground bg-foreground text-background font-medium"
      : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
  }`;
// 뷰 토글 칩(테이블/카드). 활성 = primary.
const viewCls = (active: boolean) =>
  `shrink-0 rounded-sm border px-2 py-1 text-xs transition ${
    active
      ? "border-primary bg-primary text-primary-foreground font-medium"
      : "border-line text-text-dim hover:bg-bg-soft"
  }`;

type ClassFilterState = {
  subject: string;
  teacher: string;
  days: string[];
  q: string;
  view: ViewMode;
  sort: ClassSort;
};

function buildHref(current: ClassFilterState, patch: Partial<ClassFilterState>): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.subject !== "all") params.set("subject", next.subject);
  if (next.teacher !== "all") params.set("teacher", next.teacher);
  if (next.days.length) params.set("days", next.days.join(","));
  if (next.q) params.set("q", next.q);
  if (next.view !== "table") params.set("view", next.view);
  if (next.sort !== "name") params.set("sort", next.sort);
  const s = params.toString();
  return s ? `/classes?${s}` : "/classes";
}

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
    page?: string;
  }>;
}) {
  await requireAccess("classes");
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
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows: classes, total }, teachers, stats] = await Promise.all([
    getClassesPage({ subject, teacherId, days, q, sort }, page, PAGE_SIZE),
    getClassTeacherOptions(),
    getClassesStats(),
  ]);

  const totalSeats = stats.totalSeats;
  const active = stats.active;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current: ClassFilterState = { subject, teacher: teacherId, days, q, view, sort };

  // 과목이 선택되면 해당 과목 담당 강사만 드롭다운에 노출.
  const teacherFilterOptions =
    subject === "all" ? teachers : teachers.filter((t) => teacherTeaches(t.subjects, subject));
  // 선택된 강사가 새 과목을 담당하지 않으면 과목 전환 시 강사 필터를 초기화한다.
  const selectedTeacher = teacherId === "all" ? null : teachers.find((t) => t.id === teacherId);
  const subjectHref = (key: string) =>
    buildHref(current, {
      subject: key,
      ...(key !== "all" && selectedTeacher && !teacherTeaches(selectedTeacher.subjects, key)
        ? { teacher: "all" }
        : {}),
    });
  // 요일 토글 — 이미 선택돼 있으면 빼고, 아니면 더한다(다중).
  const dayHref = (key: string) =>
    buildHref(current, {
      days: days.includes(key) ? days.filter((d) => d !== key) : [...days, key],
    });
  const pageHref = (p: number) => {
    const base = new URLSearchParams(buildHref(current, {}).split("?")[1] ?? "");
    if (p > 1) base.set("page", String(p));
    const s = base.toString();
    return s ? `/classes?${s}` : "/classes";
  };

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="전체 반" value={stats.total} unit="개" icon={BookOpen} color="primary" />
        <Stat label="운영 중" value={active} unit="개" icon={CheckIcon} color="primary" />
        <Stat label="등록 학생" value={totalSeats} unit="명" icon={Users} color="blue" />
        <Stat
          label="반당 평균"
          value={stats.total > 0 ? Math.round(totalSeats / stats.total) : 0}
          unit="명"
          icon={UserCheck}
          color="gold"
        />
      </section>

      {/* Filter bar — ijw 패리티: 넓은 창에선 한 줄, 좁아지면 자연스럽게 줄바꿈(flex-wrap) */}
      <div className="bg-card border-line shadow-card rounded-md border px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
          {/* 과목 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">과목</span>
            {SUBJECT_FILTERS.map((f) => (
              <Link key={f.key} href={subjectHref(f.key)} className={chipCls(subject === f.key)}>
                {f.label}
              </Link>
            ))}
          </div>

          <span className="bg-line hidden h-4 w-px shrink-0 sm:block" aria-hidden />

          {/* 강사 */}
          <div className="flex items-center gap-1.5">
            <span className="micro mr-1">강사</span>
            <FilterSelect
              paramName="teacher"
              value={teacherId === "all" ? null : teacherId}
              options={teacherFilterOptions.map((t) => ({ value: t.id, label: t.name }))}
              ariaLabel="강사 필터"
              className="w-36"
            />
          </div>

          <span className="bg-line hidden h-4 w-px shrink-0 sm:block" aria-hidden />

          {/* 요일 (다중 선택) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">요일</span>
            <Link href={buildHref(current, { days: [] })} className={chipCls(days.length === 0)}>
              전체
            </Link>
            {DAY_FILTERS.map((f) => (
              <Link key={f.key} href={dayHref(f.key)} className={chipCls(days.includes(f.key))}>
                {f.label}
              </Link>
            ))}
          </div>

          <span className="bg-line hidden h-4 w-px shrink-0 sm:block" aria-hidden />

          {/* 정렬 */}
          <div className="flex items-center gap-1.5">
            <span className="micro mr-1">정렬</span>
            <FilterSelect
              paramName="sort"
              value={sort === "name" ? null : sort}
              options={SORT_OPTIONS}
              allLabel="수업명순"
              allValue="name"
              ariaLabel="정렬 기준"
              className="w-28"
            />
          </div>

          {/* 검색 + 뷰 토글 (넓을 땐 우측 정렬) */}
          <form action="/classes" method="get" className="ml-auto flex items-center gap-2">
            {subject !== "all" ? <input type="hidden" name="subject" value={subject} /> : null}
            {teacherId !== "all" ? <input type="hidden" name="teacher" value={teacherId} /> : null}
            {days.length ? <input type="hidden" name="days" value={days.join(",")} /> : null}
            {sort !== "name" ? <input type="hidden" name="sort" value={sort} /> : null}
            {view !== "table" ? <input type="hidden" name="view" value={view} /> : null}
            <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
              <EyIcon name="search" size={13} />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="수업명, 강사명 검색"
                className="text-foreground placeholder:text-text-faint w-36 bg-transparent text-xs focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1">
              <Link href={buildHref(current, { view: "table" })} className={viewCls(view === "table")}>
                테이블
              </Link>
              <Link href={buildHref(current, { view: "cards" })} className={viewCls(view === "cards")}>
                카드
              </Link>
            </div>
          </form>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="micro">
          결과 <span className="text-foreground font-bold">{total}</span>개
          {totalPages > 1 ? (
            <span className="text-text-faint ml-2 normal-case">
              · {page}/{totalPages} 페이지
            </span>
          ) : null}
        </p>
        <NewClassTrigger />
      </div>

      {total === 0 ? (
        <EmptyState icon={() => <SearchX size={32} strokeWidth={1.5} />} title="결과 없음" />
      ) : (
        <>
          {view === "table" ? <TableView classes={classes} /> : <CardsView classes={classes} />}
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}

/**
 * 운영 요일 칩 + 시작시각. 모든 요일이 같은 시각이면 시각 1개만(월·수·금 14:30),
 * 요일마다 다르면 요일별로(월14:30 목16:20). 시각 정보가 목록에서 사라지던 격차 보강.
 */
function DayChips({ days, subject }: { days: ClassDaySlot[]; subject: string }) {
  if (days.length === 0) return <span className="text-text-faint text-xs">—</span>;
  const starts = days.map((d) => d.start).filter((s): s is string => !!s);
  const uniform = starts.length === days.length && new Set(starts).size === 1;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <div className="flex gap-0.5 font-mono text-[11px]">
        {days.map((d) => (
          <span
            key={d.day}
            className={`inline-flex size-5 items-center justify-center rounded-sm ${SUBJECT_BAR[subject] ?? "bg-bg-soft"} text-white`}
          >
            {DAY_LABEL[d.day] ?? d.day}
          </span>
        ))}
      </div>
      {uniform ? (
        <span className="text-text-dim tabular text-[11px]">{starts[0]}</span>
      ) : starts.length > 0 ? (
        <span className="text-text-faint tabular text-[10px]">
          {days
            .filter((d) => d.start)
            .map((d) => `${DAY_LABEL[d.day] ?? d.day}${d.start}`)
            .join(" ")}
        </span>
      ) : null}
    </div>
  );
}

function TableView({ classes }: { classes: ClassListRow[] }) {
  return (
    <div className="bg-card border-line shadow-card overflow-auto rounded-md border">
      <table className="w-full text-sm [&_td]:whitespace-nowrap">
        <thead className="border-line border-b [&_th]:whitespace-nowrap">
          <tr>
            <th className="micro px-4 py-3 text-left">과목</th>
            <th className="micro px-4 py-3 text-left">반 이름</th>
            <th className="micro px-4 py-3 text-left">담임</th>
            <th className="micro px-4 py-3 text-left">강의실</th>
            <th className="micro px-4 py-3 text-left">요일</th>
            <th className="micro px-4 py-3 text-right">학생</th>
            <th className="micro px-4 py-3 text-left">상태</th>
            <th className="micro px-4 py-3 text-left">메모</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {classes.map((c) => {
            const meta = SUBJECT_META[c.subject] ?? { label: c.subject, color: "neutral" as PillColor };
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
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {c.teacherName ? (
                      <span className="text-text-dim text-[12px]">{c.teacherName}</span>
                    ) : (
                      <span className="text-text-faint text-xs">미정</span>
                    )}
                  </div>
                </td>
                <td className="text-text-dim font-mono px-4 py-2.5 text-[11px]">
                  {c.classroomName ?? "—"}
                </td>
                <td className="px-4 py-2.5">
                  <DayChips days={c.days} subject={c.subject} />
                </td>
                <td className="text-foreground num px-4 py-2.5 text-right text-[12px] font-bold">
                  {c.studentCount}명
                </td>
                <td className="px-4 py-2.5">
                  {c.isActive ? (
                    <Pill color="primary" soft={false}>
                      운영
                    </Pill>
                  ) : (
                    <Pill color="neutral">종료</Pill>
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

function CardsView({ classes }: { classes: ClassListRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {classes.map((c) => {
        const meta = SUBJECT_META[c.subject] ?? { label: c.subject, color: "neutral" as PillColor };
        return (
          <WindowLink
            key={c.id}
            href={`/classes/${c.id}`}
            title={c.className}
            className="bg-card border-line shadow-card hover:shadow-card-hover flex flex-col gap-4 rounded-md border p-5 transition"
          >
            <header className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Pill color={meta.color}>{meta.label}</Pill>
                {c.isActive ? (
                  <Pill color="primary" soft={false}>
                    ● 운영
                  </Pill>
                ) : (
                  <Pill color="neutral">종료</Pill>
                )}
              </div>
            </header>
            <h3 className="text-foreground text-[17px] font-extrabold leading-tight">
              {c.className}
            </h3>
            <div className="text-[12px]">
              <div className="flex items-center gap-2">
                <span className="text-text-dim flex-1 truncate">
                  {c.teacherName ?? "담임 미정"} 강사
                </span>
                {c.classroomName ? (
                  <span className="text-text-faint font-mono text-[11px]">{c.classroomName}</span>
                ) : null}
              </div>
            </div>
            <div className="border-line flex items-center justify-between gap-2 border-t pt-3">
              <DayChips days={c.days} subject={c.subject} />
              <span className="text-foreground num shrink-0 text-[12px] font-bold">
                재원 {c.studentCount}명
              </span>
            </div>
          </WindowLink>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  unit: string;
  icon: LucideIcon;
  color: "primary" | "blue" | "gold";
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    blue: "bg-blue-soft text-blue",
    gold: "bg-gold-soft text-gold",
  } as const;
  return (
    <div className="bg-card border-line shadow-card rounded-md border p-4">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-sm ${ICON_BG[color]}`}>
          <Icon size={13} strokeWidth={2} />
        </span>
      </header>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-foreground text-[28px] leading-none">{value}</span>
        <span className="text-text-dim text-xs">{unit}</span>
      </p>
    </div>
  );
}
