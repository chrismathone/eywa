import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getWeeklyScheduleWithStudents,
  type ScheduleSlotWithStudents,
} from "@/features/timetable/server/queries";

export const metadata = { title: "시간표 — eywa" };

type ViewMode = "basic" | "integrated";
type SubjectKey = "all" | "math" | "english" | "korean" | "science" | "arts";

const SUBJECT_LABEL: Record<SubjectKey, string> = {
  all: "전체",
  math: "수학",
  english: "영어",
  korean: "국어",
  science: "과학",
  arts: "예술",
};

const SUBJECT_COLOR: Record<string, string> = {
  math: "bg-primary-soft text-primary",
  english: "bg-blue-soft text-blue",
  korean: "bg-rose-soft text-rose",
  science: "bg-purple-soft text-purple",
  arts: "bg-amber-soft text-amber",
};

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
];

function shortTime(t: string) {
  return t.slice(0, 5);
}

function toMins(hms: string): number {
  const [h, m] = hms.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * 교시 그룹화 — 시작 시간 기준 16:00→1교시 / 17:30→2교시 / 19:00→3교시 식으로.
 * 시안 데이터에는 정확한 "교시" 필드가 없으므로 시작 시간 hour로 묶음.
 */
function periodKey(startTime: string): string {
  const h = Number(startTime.slice(0, 2));
  if (h < 16) return "방과전";
  if (h < 17) return "1교시";
  if (h < 19) return "2교시";
  if (h < 20) return "3교시";
  return "4교시";
}

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: ViewMode; subject?: SubjectKey }>;
}) {
  await requireAccess("timetable");
  const { view: viewParam, subject: subjectParam } = await searchParams;
  const view: ViewMode = viewParam === "integrated" ? "integrated" : "basic";
  const subject: SubjectKey =
    subjectParam && subjectParam in SUBJECT_LABEL ? subjectParam : "all";

  const allSlots = await getWeeklyScheduleWithStudents();
  const slots = subject === "all" ? allSlots : allSlots.filter((s) => s.subject === subject);

  // counters
  const totalStudents = slots.reduce((s, x) => s + x.students.length, 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
        {/* 과목 chip */}
        <div className="flex items-center gap-1">
          <span className="micro mr-1">과목</span>
          {(Object.keys(SUBJECT_LABEL) as SubjectKey[]).map((k) => (
            <Link
              key={k}
              href={buildHref(view, k)}
              className={`shrink-0 rounded-md border px-2 py-0.5 text-xs transition ${
                subject === k
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {SUBJECT_LABEL[k]}
            </Link>
          ))}
        </div>

        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 뷰 토글 */}
        <div className="flex items-center gap-1">
          <span className="micro mr-1">뷰</span>
          {([
            { key: "basic", label: "기본뷰", icon: "leaf" },
            { key: "integrated", label: "통합뷰", icon: "rings" },
          ] as { key: ViewMode; label: string; icon: Parameters<typeof EyIcon>[0]["name"] }[]).map((v) => (
            <Link
              key={v.key}
              href={buildHref(v.key, subject)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition ${
                view === v.key
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              <EyIcon name={v.icon} size={11} />
              {v.label}
            </Link>
          ))}
        </div>

        <span className="text-text-faint ml-auto font-mono text-[11px]">
          총 {slots.length}슬롯 · {totalStudents}명 등록
        </span>
      </div>

      {slots.length === 0 ? (
        <EmptyState
          icon={() => <EyIcon name="leaf" size={32} />}
          title="해당 과목의 시간표가 없습니다"
        />
      ) : view === "basic" ? (
        <BasicView slots={slots} />
      ) : (
        <IntegratedView slots={slots} />
      )}
    </div>
  );
}

function buildHref(view: ViewMode, subject: SubjectKey): string {
  const params = new URLSearchParams();
  if (view !== "basic") params.set("view", view);
  if (subject !== "all") params.set("subject", subject);
  const q = params.toString();
  return q ? `/timetable?${q}` : "/timetable";
}

// ─────────────────── 기본뷰 — 강사 × 요일 × 교시 ───────────────────

function BasicView({ slots }: { slots: ScheduleSlotWithStudents[] }) {
  // 강사 + 요일 그룹화. 같은 강사가 여러 요일에 가르치면 column 안에 요일별 sub-column
  const teachers = Array.from(new Set(slots.map((s) => s.teacherName ?? "—"))).sort();
  const periods = Array.from(new Set(slots.map((s) => periodKey(s.startTime)))).sort(
    (a, b) => periodOrder(a) - periodOrder(b),
  );

  // 각 (teacher, day) 쌍의 슬롯 — 강사가 가르치는 요일만 컬럼 표시
  const teacherDays = new Map<string, string[]>();
  for (const t of teachers) {
    const days = Array.from(
      new Set(slots.filter((s) => (s.teacherName ?? "—") === t).map((s) => s.dayOfWeek)),
    ).sort((a, b) => DAYS.findIndex((d) => d.key === a) - DAYS.findIndex((d) => d.key === b));
    teacherDays.set(t, days);
  }

  // (teacher, day, period) → slots
  const cell = new Map<string, ScheduleSlotWithStudents[]>();
  for (const s of slots) {
    const k = `${s.teacherName ?? "—"}::${s.dayOfWeek}::${periodKey(s.startTime)}`;
    const list = cell.get(k) ?? [];
    list.push(s);
    cell.set(k, list);
  }

  return (
    <div className="bg-card border-line shadow-card overflow-auto rounded-2xl border">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="bg-bg-soft border-line sticky left-0 z-10 border-b border-r p-3 text-left">
              <span className="micro">교시</span>
            </th>
            {teachers.map((t) => {
              const days = teacherDays.get(t) ?? [];
              return (
                <th
                  key={t}
                  colSpan={days.length}
                  className="bg-bg-soft border-line border-b border-r px-3 py-2.5 text-center"
                >
                  <p className="text-foreground text-[13px] font-bold">{t}</p>
                </th>
              );
            })}
          </tr>
          <tr>
            <th className="bg-bg-soft border-line sticky left-0 z-10 border-b border-r p-2" />
            {teachers.flatMap((t) =>
              (teacherDays.get(t) ?? []).map((d) => (
                <th
                  key={`${t}-${d}`}
                  className="bg-bg-soft/60 border-line text-text-dim min-w-[180px] border-b border-r px-2 py-1.5 text-center font-mono text-[10px] font-bold"
                >
                  {DAYS.find((x) => x.key === d)?.label ?? d}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p}>
              <td className="bg-bg-soft/40 border-line text-foreground sticky left-0 z-10 border-b border-r px-3 py-3 align-top text-[12px] font-bold">
                {p}
                <div className="text-text-faint mt-1 font-mono text-[10px]">
                  {periodTimeRange(p)}
                </div>
              </td>
              {teachers.flatMap((t) =>
                (teacherDays.get(t) ?? []).map((d) => {
                  const list = cell.get(`${t}::${d}::${p}`) ?? [];
                  return (
                    <td
                      key={`${t}-${d}-${p}`}
                      className="border-line border-b border-r p-2 align-top"
                    >
                      {list.length === 0 ? (
                        <span className="text-text-faint text-[11px]">—</span>
                      ) : (
                        <div className="space-y-2">
                          {list.map((s) => (
                            <ClassBlock key={s.id} slot={s} compact />
                          ))}
                        </div>
                      )}
                    </td>
                  );
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────── 통합뷰 — 요일 × 교시 + 다중 수업 ───────────────────

function IntegratedView({ slots }: { slots: ScheduleSlotWithStudents[] }) {
  const periods = Array.from(new Set(slots.map((s) => periodKey(s.startTime)))).sort(
    (a, b) => periodOrder(a) - periodOrder(b),
  );

  // (day, period) → slots
  const cell = new Map<string, ScheduleSlotWithStudents[]>();
  for (const s of slots) {
    const k = `${s.dayOfWeek}::${periodKey(s.startTime)}`;
    const list = cell.get(k) ?? [];
    list.push(s);
    cell.set(k, list);
  }

  return (
    <div className="bg-card border-line shadow-card overflow-auto rounded-2xl border">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="bg-bg-soft border-line sticky left-0 z-10 w-[100px] border-b border-r p-3 text-left">
              <span className="micro">교시</span>
            </th>
            {DAYS.map((d) => (
              <th
                key={d.key}
                className="bg-bg-soft border-line min-w-[200px] border-b border-r px-3 py-2.5 text-center"
              >
                <span className="text-foreground text-[13px] font-bold">{d.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p}>
              <td className="bg-bg-soft/40 border-line text-foreground sticky left-0 z-10 border-b border-r px-3 py-3 align-top text-[12px] font-bold">
                {p}
                <div className="text-text-faint mt-1 font-mono text-[10px]">
                  {periodTimeRange(p)}
                </div>
              </td>
              {DAYS.map((d) => {
                const list = (cell.get(`${d.key}::${p}`) ?? []).sort((a, b) =>
                  a.startTime.localeCompare(b.startTime),
                );
                return (
                  <td
                    key={`${d.key}-${p}`}
                    className="border-line border-b border-r p-2 align-top"
                  >
                    {list.length === 0 ? (
                      <span className="text-text-faint text-[11px]">—</span>
                    ) : (
                      <div className="space-y-1.5">
                        {list.map((s) => (
                          <ClassBlock key={s.id} slot={s} />
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────── ClassBlock — 셀 안의 수업 블록 ───────────────────

function ClassBlock({
  slot,
  compact = false,
}: {
  slot: ScheduleSlotWithStudents;
  compact?: boolean;
}) {
  const color = SUBJECT_COLOR[slot.subject] ?? "bg-bg-soft text-text-dim";
  return (
    <div className={`rounded-md px-2 py-1.5 ${color}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[11px] font-bold">{slot.className}</p>
        <span className="num font-mono text-[10px] opacity-70">
          {shortTime(slot.startTime)}~{shortTime(slot.endTime)}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-1 text-[10px] opacity-80">
        {slot.classroomName ? <span className="font-mono">{slot.classroomName}</span> : <span />}
        <span className="num font-bold">{slot.students.length}명</span>
      </div>
      {!compact && slot.students.length > 0 ? (
        <p className="mt-1 line-clamp-2 text-[10px] opacity-70">
          {slot.students.map((s) => `${s.name}/${s.grade ?? "—"}`).join(", ")}
        </p>
      ) : null}
      {compact && slot.students.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-[10px] opacity-75">
          {slot.students.slice(0, 6).map((s) => (
            <li key={s.name} className="truncate">
              {s.name}
              {s.grade ? <span className="opacity-60"> · {s.grade}</span> : null}
            </li>
          ))}
          {slot.students.length > 6 ? (
            <li className="opacity-60">외 {slot.students.length - 6}명</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function periodOrder(p: string): number {
  if (p === "방과전") return 0;
  const n = Number(p.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : 99;
}

function periodTimeRange(p: string): string {
  switch (p) {
    case "방과전":
      return "~ 15:59";
    case "1교시":
      return "16:00 ~ 16:59";
    case "2교시":
      return "17:00 ~ 18:59";
    case "3교시":
      return "19:00 ~ 19:59";
    case "4교시":
      return "20:00 ~";
    default:
      return "";
  }
}
