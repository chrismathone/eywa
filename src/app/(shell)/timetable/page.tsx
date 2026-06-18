import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Columns3, LayoutGrid, CalendarOff } from "lucide-react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { EmptyState } from "@/components/empty-state";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getWeeklyScheduleWithStudents,
  type ScheduleSlotWithStudents,
} from "@/features/timetable/server/queries";
import {
  slotPeriodRow,
  type DayOfWeek,
  type PeriodRow,
  type TimetableSubject,
} from "@/features/timetable/lib/periods";
import { IntegratedCell } from "./_components/integrated-cell";
import { TimetableBoard } from "./_components/timetable-board";
import { TimetableToolbarActions } from "./_components/toolbar-actions";
import { WeekdayGroupTables } from "./_components/weekday-group-tables";

export const metadata = { title: "시간표 — eywa" };

type ViewMode = "basic" | "integrated";
// 과목별 교시 체계가 달라(수학 8교시·영어 10교시·주말 시간단위) "전체"는 없다 —
// 무조건 한 과목 선택(기본 수학). 실제 데이터에 존재하는 과목만 칩으로 노출.
type SubjectKey = "math" | "english" | "highmath" | "korean" | "science" | "arts";

const SUBJECT_LABEL: Record<SubjectKey, string> = {
  math: "수학",
  english: "영어",
  highmath: "고등수학",
  korean: "국어",
  science: "과학",
  arts: "예술",
};
const SUBJECT_ORDER: SubjectKey[] = ["math", "english", "highmath", "korean", "science", "arts"];
const DEFAULT_SUBJECT: SubjectKey = "math";

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
  { key: "sun", label: "일" },
];

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: ViewMode; subject?: SubjectKey }>;
}) {
  await requireAccess("timetable");
  const { view: viewParam, subject: subjectParam } = await searchParams;
  const view: ViewMode = viewParam === "integrated" ? "integrated" : "basic";

  const allSlots = await getWeeklyScheduleWithStudents();
  // 데이터에 실제 존재하는 과목만 칩으로(빈 과목칩 방지). 무조건 한 과목 — 기본 수학, 없으면 첫 과목.
  const available = SUBJECT_ORDER.filter((k) => allSlots.some((s) => s.subject === k));
  const subject: SubjectKey =
    subjectParam && available.includes(subjectParam)
      ? subjectParam
      : available.includes(DEFAULT_SUBJECT)
        ? DEFAULT_SUBJECT
        : (available[0] ?? DEFAULT_SUBJECT);
  const slots = allSlots.filter((s) => s.subject === subject);

  // counters
  const totalStudents = slots.reduce((s, x) => s + x.students.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Toolbar */}
      <div className="bg-card border-line shadow-card flex shrink-0 flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
        {/* 과목 chip */}
        <div className="flex items-center gap-1">
          <span className="micro mr-1">과목</span>
          {available.map((k) => (
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
            { key: "basic", label: "기본뷰", icon: Columns3 },
            { key: "integrated", label: "통합뷰", icon: LayoutGrid },
          ] as { key: ViewMode; label: string; icon: LucideIcon }[]).map((v) => {
            const Icon = v.icon;
            return (
              <Link
                key={v.key}
                href={buildHref(v.key, subject)}
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

        <TimetableToolbarActions />
      </div>

      {slots.length === 0 ? (
        <EmptyState
          icon={() => <CalendarOff size={32} strokeWidth={1.5} />}
          title="해당 과목의 시간표가 없습니다"
        />
      ) : (
        <TimetableBoard>
          <div id="timetable-export-root" className="flex min-h-0 flex-1 flex-col">
            {view === "basic" ? (
              <WeekdayGroupTables slots={slots} />
            ) : (
              <IntegratedView slots={slots} />
            )}
          </div>
        </TimetableBoard>
      )}
    </div>
  );
}

function buildHref(view: ViewMode, subject: SubjectKey): string {
  const params = new URLSearchParams();
  if (view !== "basic") params.set("view", view);
  if (subject !== DEFAULT_SUBJECT) params.set("subject", subject);
  const q = params.toString();
  return q ? `/timetable?${q}` : "/timetable";
}

// ─────────────────── 통합뷰 — 요일 × 교시(과목 교시표) + 다중 수업 ───────────────────

function IntegratedView({ slots }: { slots: ScheduleSlotWithStudents[] }) {
  const subject = (slots[0]?.subject ?? "math") as TimetableSubject;
  const rowOf = (s: ScheduleSlotWithStudents) =>
    slotPeriodRow(subject, s.startTime, s.dayOfWeek as DayOfWeek);

  const rowMap = new Map<string, PeriodRow>();
  for (const s of slots) {
    const r = rowOf(s);
    if (!rowMap.has(r.key)) rowMap.set(r.key, r);
  }
  const rows = Array.from(rowMap.values()).sort((a, b) => a.order - b.order);

  // (day, period) → slots
  const cell = new Map<string, ScheduleSlotWithStudents[]>();
  for (const s of slots) {
    const k = `${s.dayOfWeek}::${rowOf(s).key}`;
    const list = cell.get(k) ?? [];
    list.push(s);
    cell.set(k, list);
  }

  return (
    <DragScrollArea className="bg-card border-line shadow-card min-h-0 flex-1 rounded-2xl border">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="bg-bg-soft border-line sticky left-0 z-10 w-[100px] border-b border-r p-3 text-left">
              <span className="micro">교시</span>
            </th>
            {DAYS.map((d) => (
              <th
                key={d.key}
                className={`${weekdayTint(d.key)} border-line min-w-[200px] border-b border-r px-3 py-2.5 text-center`}
              >
                <span className="text-foreground text-[13px] font-bold">{d.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="bg-bg-soft border-line text-foreground sticky left-0 z-10 border-b border-r px-3 py-3 align-top text-[12px] font-bold whitespace-nowrap">
                {row.label}
                <div className="text-text-faint mt-1 font-mono text-[10px]">{row.time}</div>
              </td>
              {DAYS.map((d) => {
                const list = (cell.get(`${d.key}::${row.key}`) ?? [])
                  .slice()
                  .sort((a, b) => a.startTime.localeCompare(b.startTime));
                return (
                  <td key={`${d.key}-${row.key}`} className="border-line border-b border-r p-2 align-top">
                    <IntegratedCell slots={list} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </DragScrollArea>
  );
}

/** 요일 컬러 밴드 — ijw식 요일 그룹(월목/화금/수/주말) 색 구분. 헤더 배경만 틴트(셀은 과목색 유지). */
function weekdayTint(dayKey: string): string {
  switch (dayKey) {
    case "mon":
    case "thu":
      return "bg-blue-soft";
    case "tue":
    case "fri":
      return "bg-purple-soft";
    case "wed":
      return "bg-primary-soft";
    case "sat":
    case "sun":
      return "bg-amber-soft";
    default:
      return "bg-bg-soft";
  }
}
