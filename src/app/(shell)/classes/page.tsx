import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { Initial } from "@/components/atoms/initial";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getClassesList,
  getClassTeacherOptions,
  type ClassListRow,
} from "@/features/classes/server/queries";
import { getClassroomOptions } from "@/features/enrollments/server/queries";
import { NewClassTrigger } from "./_components/new-class-trigger";

export const metadata = { title: "수업목록 — eywa" };

type ViewMode = "cards" | "table";

const SUBJECT_META: Record<string, { label: string; color: PillColor }> = {
  math: { label: "수학", color: "primary" },
  english: { label: "영어", color: "blue" },
  korean: { label: "국어", color: "rose" },
  science: { label: "과학", color: "purple" },
  arts: { label: "예술", color: "amber" },
};

const SUBJECT_BAR: Record<string, string> = {
  math: "bg-primary",
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
  { key: "english", label: "영어" },
  { key: "korean", label: "국어" },
  { key: "science", label: "과학" },
  { key: "arts", label: "예술" },
];

const DAY_FILTERS = [
  { key: "all", label: "전체" },
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
];

function buildHref(
  current: { subject: string; teacher: string; day: string; q: string; view: ViewMode },
  patch: Partial<{ subject: string; teacher: string; day: string; q: string; view: ViewMode }>,
): string {
  const params = new URLSearchParams();
  const next = { ...current, ...patch };
  if (next.subject !== "all") params.set("subject", next.subject);
  if (next.teacher !== "all") params.set("teacher", next.teacher);
  if (next.day !== "all") params.set("day", next.day);
  if (next.q) params.set("q", next.q);
  if (next.view !== "table") params.set("view", next.view);
  const s = params.toString();
  return s ? `/classes?${s}` : "/classes";
}

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{
    subject?: string;
    teacher?: string;
    day?: string;
    q?: string;
    view?: ViewMode;
  }>;
}) {
  await requireAccess("classes");
  const sp = await searchParams;
  const subject = sp.subject ?? "all";
  const teacherId = sp.teacher ?? "all";
  const day = sp.day ?? "all";
  const q = sp.q ?? "";
  const view: ViewMode = sp.view === "cards" ? "cards" : "table";

  const [classes, teachers, all, classrooms] = await Promise.all([
    getClassesList({ subject, teacherId, day, q }),
    getClassTeacherOptions(),
    getClassesList({}),
    getClassroomOptions(),
  ]);

  const totalSeats = all.reduce((s, c) => s + c.studentCount, 0);
  const active = all.filter((c) => c.isActive).length;
  const current = { subject, teacher: teacherId, day, q, view };

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="전체 반" value={all.length} unit="개" icon="branch" color="primary" />
        <Stat label="운영 중" value={active} unit="개" icon="check" color="primary" />
        <Stat label="등록 학생" value={totalSeats} unit="명" icon="seed" color="blue" />
        <Stat
          label="반당 평균"
          value={all.length > 0 ? Math.round(totalSeats / all.length) : 0}
          unit="명"
          icon="rings"
          color="gold"
        />
      </section>

      {/* Filter bar */}
      <div className="bg-card border-line shadow-card space-y-3 rounded-md border px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* 과목 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">과목</span>
            {SUBJECT_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref(current, { subject: f.key })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  subject === f.key
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>

          <span className="bg-line h-4 w-px" aria-hidden />

          {/* 요일 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">요일</span>
            {DAY_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref(current, { day: f.key })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  day === f.key
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* 강사 select */}
          <div className="flex items-center gap-1.5">
            <span className="micro mr-1">강사</span>
            <Link
              href={buildHref(current, { teacher: "all" })}
              className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                teacherId === "all"
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              전체
            </Link>
            {teachers.map((t) => (
              <Link
                key={t.id}
                href={buildHref(current, { teacher: t.id })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  teacherId === t.id
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {t.name}
              </Link>
            ))}
          </div>

          {/* 검색 + 뷰 토글 */}
          <form action="/classes" method="get" className="ml-auto flex items-center gap-2">
            {subject !== "all" ? <input type="hidden" name="subject" value={subject} /> : null}
            {teacherId !== "all" ? <input type="hidden" name="teacher" value={teacherId} /> : null}
            {day !== "all" ? <input type="hidden" name="day" value={day} /> : null}
            {view !== "table" ? <input type="hidden" name="view" value={view} /> : null}
            <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
              <EyIcon name="search" size={13} />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="반 이름"
                className="text-foreground placeholder:text-text-faint w-32 bg-transparent text-xs focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1">
              <Link
                href={buildHref(current, { view: "table" })}
                className={`shrink-0 rounded-sm border px-2 py-1 text-xs transition ${
                  view === "table"
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line text-text-dim hover:bg-bg-soft"
                }`}
              >
                테이블
              </Link>
              <Link
                href={buildHref(current, { view: "cards" })}
                className={`shrink-0 rounded-sm border px-2 py-1 text-xs transition ${
                  view === "cards"
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line text-text-dim hover:bg-bg-soft"
                }`}
              >
                카드
              </Link>
            </div>
          </form>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="micro">
          결과 <span className="text-foreground font-bold">{classes.length}</span>개
        </p>
        <NewClassTrigger teacherOptions={teachers} classroomOptions={classrooms} />
      </div>

      {classes.length === 0 ? (
        <EmptyState icon={() => <EyIcon name="branch" size={32} />} title="결과 없음" />
      ) : view === "table" ? (
        <TableView classes={classes} />
      ) : (
        <CardsView classes={classes} />
      )}
    </div>
  );
}

function TableView({ classes }: { classes: ClassListRow[] }) {
  return (
    <div className="bg-card border-line shadow-card overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-line border-b">
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
                  <Link
                    href={`/classes/${c.id}`}
                    className="text-foreground text-[13px] font-bold hover:underline"
                  >
                    {c.className}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {c.teacherName ? (
                      <>
                        <Initial name={c.teacherName} color="gold" size="sm" />
                        <span className="text-text-dim text-[12px]">{c.teacherName}</span>
                      </>
                    ) : (
                      <span className="text-text-faint text-xs">미정</span>
                    )}
                  </div>
                </td>
                <td className="text-text-dim font-mono px-4 py-2.5 text-[11px]">
                  {c.classroomName ?? "—"}
                </td>
                <td className="px-4 py-2.5">
                  {c.days.length === 0 ? (
                    <span className="text-text-faint text-xs">—</span>
                  ) : (
                    <div className="flex gap-0.5 font-mono text-[11px]">
                      {c.days.map((d) => (
                        <span
                          key={d}
                          className={`text-text-dim inline-flex size-5 items-center justify-center rounded-sm ${SUBJECT_BAR[c.subject] ?? "bg-bg-soft"} text-white`}
                        >
                          {DAY_LABEL[d] ?? d}
                        </span>
                      ))}
                    </div>
                  )}
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
        const capacity = 8;
        const pct = Math.min(100, (c.studentCount / capacity) * 100);
        return (
          <Link
            key={c.id}
            href={`/classes/${c.id}`}
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
                {c.teacherName ? (
                  <Initial name={c.teacherName} color="gold" size="sm" />
                ) : (
                  <span className="bg-bg-soft size-6 rounded-sm" />
                )}
                <span className="text-text-dim flex-1 truncate">
                  {c.teacherName ?? "담임 미정"} 강사
                </span>
                {c.classroomName ? (
                  <span className="text-text-faint font-mono text-[11px]">{c.classroomName}</span>
                ) : null}
              </div>
            </div>
            <div className="border-line border-t pt-3">
              <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
                <span className="text-text-dim">정원 현황</span>
                <span className="text-foreground num font-bold">
                  {c.studentCount} / {capacity}명
                </span>
              </div>
              <div className="bg-bg-soft h-1.5 overflow-hidden rounded-sm">
                <span
                  className={`block h-full ${SUBJECT_BAR[c.subject] ?? "bg-primary"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  icon,
  color,
}: {
  label: string;
  value: number;
  unit: string;
  icon: Parameters<typeof EyIcon>[0]["name"];
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
          <EyIcon name={icon} size={13} />
        </span>
      </header>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-foreground text-[28px] leading-none">{value}</span>
        <span className="text-text-dim text-xs">{unit}</span>
      </p>
    </div>
  );
}
