import { BookOpen, Users, UserCheck, SearchX, type LucideIcon } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { EditingBadge } from "@/features/presence/editing-badge";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getClassesPage,
  getClassesStats,
  getClassTeacherOptions,
  type ClassListRow,
  type ClassDaySlot,
  type ClassSort,
} from "@/features/classes/server/queries";
import { Pagination } from "@/components/pagination";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps, SUBJECT_SOLID, type SubjectMaps } from "@/features/owner/subjects";
import { NewClassTrigger } from "./_components/new-class-trigger";
import { ClassroomAssignButton } from "./_components/classroom-assign-dialog";
import { ClassFilterBar } from "./_components/class-filter-bar";
import {
  buildClassHref,
  DAY_KEYS,
  type ClassFilterState,
  type ViewMode,
} from "./_components/filter-shared";

export const metadata = { title: "수업목록 — eywa" };

const PAGE_SIZE = 50;

// "운영 중" Stat은 보존 대상 EyIcon `check`를 유지 — Lucide 시그니처(size·strokeWidth) 어댑터로 감싸 Stat에 전달.
const CheckIcon: LucideIcon = ((props: { size?: number | string }) => (
  <EyIcon name="check" size={typeof props.size === "number" ? props.size : undefined} />
)) as unknown as LucideIcon;

const DAY_LABEL: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

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

  const [{ rows: classes, total }, teachers, stats, settings] = await Promise.all([
    getClassesPage({ subject, teacherId, days, q, sort }, page, PAGE_SIZE),
    getClassTeacherOptions(),
    getClassesStats(),
    getTenantSettings(),
  ]);

  // 과목 라벨·색·필터 옵션은 학원설정(operations.subjects) 단일 소스 — 미등록 과목은 드롭다운에 안 뜸.
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const totalSeats = stats.totalSeats;
  const active = stats.active;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current: ClassFilterState = { subject, teacher: teacherId, days, q, view, sort };

  const pageHref = (p: number) => {
    const base = new URLSearchParams(buildClassHref(current, {}).split("?")[1] ?? "");
    if (p > 1) base.set("page", String(p));
    const s = base.toString();
    return s ? `/classes?${s}` : "/classes";
  };

  return (
    <div className="space-y-4">
      <MakeeduSyncBadge domain="classes" />
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

      {/* 과목·요일·강사·정렬 드롭다운 + 검색/뷰 — 선택값 localStorage 영속(클라이언트) */}
      <ClassFilterBar current={current} teachers={teachers} subjectFilters={subjects.filters} />

      <div className="flex items-center justify-between">
        <p className="micro">
          결과 <span className="text-foreground font-bold">{total}</span>개
          {totalPages > 1 ? (
            <span className="text-text-faint ml-2 normal-case">
              · {page}/{totalPages} 페이지
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          <ClassroomAssignButton />
          <NewClassTrigger />
        </div>
      </div>

      {total === 0 ? (
        <EmptyState image="classes" icon={() => <SearchX size={32} strokeWidth={1.5} />} title="결과 없음" />
      ) : (
        <>
          {view === "table" ? (
            <TableView classes={classes} subjects={subjects} />
          ) : (
            <CardsView classes={classes} subjects={subjects} />
          )}
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
function DayChips({ days, barClass }: { days: ClassDaySlot[]; barClass: string }) {
  if (days.length === 0) return <span className="text-text-faint text-xs">—</span>;
  const starts = days.map((d) => d.start).filter((s): s is string => !!s);
  const uniform = starts.length === days.length && new Set(starts).size === 1;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <div className="flex gap-0.5 font-mono text-[11px]">
        {days.map((d) => (
          <span
            key={d.day}
            className={`inline-flex size-5 items-center justify-center rounded-sm ${barClass} text-white`}
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

function TableView({ classes, subjects }: { classes: ClassListRow[]; subjects: SubjectMaps }) {
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
                  <DayChips days={c.days} barClass={SUBJECT_SOLID[meta.color]} />
                </td>
                <td className="text-foreground num px-4 py-2.5 text-right text-[12px] font-bold">
                  {c.studentCount}명
                </td>
                <td className="px-4 py-2.5">
                  {!c.isActive ? (
                    <Pill color="neutral">폐지</Pill>
                  ) : c.closedAt ? (
                    <Pill color="amber">종강</Pill>
                  ) : (
                    <Pill color="primary" soft={false}>
                      운영
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

function CardsView({ classes, subjects }: { classes: ClassListRow[]; subjects: SubjectMaps }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {classes.map((c) => {
        const meta = { label: subjects.labelOf(c.subject), color: subjects.colorOf(c.subject) };
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
                {!c.isActive ? (
                  <Pill color="neutral">폐지</Pill>
                ) : c.closedAt ? (
                  <Pill color="amber">종강</Pill>
                ) : (
                  <Pill color="primary" soft={false}>
                    ● 운영
                  </Pill>
                )}
              </div>
            </header>
            <h3 className="text-foreground flex flex-wrap items-center gap-1.5 text-[17px] font-extrabold leading-tight">
              {c.className}
              <EditingBadge scope={`class:${c.id}`} />
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
              <DayChips days={c.days} barClass={SUBJECT_SOLID[meta.color]} />
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
