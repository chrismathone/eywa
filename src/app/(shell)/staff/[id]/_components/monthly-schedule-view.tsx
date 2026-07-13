"use client";

// 직원 상세 '월간일정' 탭(Notion 업무, 읽기 전용) — 그리드⇄리스트 토글 + 월 이동 + 미매핑 시 연결 UI.
// 근무일정 탭을 대체(근무시간 편집기는 휴면). 초기 데이터는 서버 탭에서 주입, 월 이동은 서버 액션 재호출.
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { EmptyState } from "@/components/empty-state";
import { kstToday } from "@/lib/date-kst";
import { buildMonthGrid, monthLabel, shiftMonth } from "@/lib/month-grid";
import { groupTasksByDate, type NotionTask } from "@/features/staff/notion-tasks";
import { getStaffMonthlyTasks, setStaffNotionUserId } from "@/features/staff/server/notion-actions";
import type { MonthlyTasksResult, NotionUserOption } from "@/features/staff/server/notion";
import { MonthGridView } from "./month-grid-view";
import { TaskDetailDialog } from "./task-detail-dialog";

const VIEW_KEY = "eywa-monthly-view";
type ViewMode = "grid" | "list";

function Panel({ title, desc }: { title: string; desc?: string }) {
  return (
    <EmptyState
      image="staff"
      icon={() => <CalendarDays size={30} strokeWidth={1.5} />}
      title={title}
      description={desc}
    />
  );
}

/** 리스트 뷰 — 마감일순 그룹. 좁은 창·빠른 스캔용. 항목 클릭 시 상세·댓글 다이얼로그. */
function MonthListView({
  tasks,
  today,
  onOpen,
}: {
  tasks: NotionTask[];
  today: string;
  onOpen: (t: NotionTask) => void;
}) {
  const byDate = groupTasksByDate(tasks);
  const dates = Object.keys(byDate).sort();
  if (dates.length === 0)
    return <p className="text-text-faint px-1 py-6 text-center text-[13px]">이 달에 등록된 업무가 없습니다.</p>;
  return (
    <div className="border-line bg-card divide-line divide-y rounded-md border">
      {dates.map((d) => (
        <div key={d} className="flex gap-3 px-3 py-2">
          <div className={`num w-16 shrink-0 text-[12px] ${d === today ? "text-primary font-semibold" : "text-text-dim"}`}>
            {d.slice(5).replace("-", "/")}
          </div>
          <div className="flex-1 space-y-1">
            {byDate[d]!.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onOpen(t)}
                className="hover:text-primary flex w-full items-center gap-1.5 text-left text-[12px]"
              >
                <span className={t.done ? "text-text-faint line-through" : "text-foreground"}>{t.title}</span>
                {t.dept ? <span className="text-text-faint">· {t.dept}</span> : null}
                {t.done ? <span className="text-primary text-[10px]">완료</span> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MonthlyScheduleView({
  staffId,
  canManage,
  initialMonth,
  initial,
  userOptions,
}: {
  staffId: string;
  canManage: boolean;
  initialMonth: string;
  initial: MonthlyTasksResult;
  userOptions: NotionUserOption[];
}) {
  const [month, setMonth] = useState(initialMonth);
  const [result, setResult] = useState<MonthlyTasksResult>(initial);
  const [pending, start] = useTransition();
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    const saved = window.localStorage.getItem(VIEW_KEY);
    return saved === "list" || saved === "grid" ? saved : "grid";
  });
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [openTask, setOpenTask] = useState<NotionTask | null>(null);
  const today = kstToday();

  function pickView(v: ViewMode) {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* localStorage 불가 — 무시 */
    }
  }
  function goMonth(next: string) {
    setMonth(next);
    start(async () => setResult(await getStaffMonthlyTasks(staffId, next)));
  }
  async function saveMapping() {
    if (!selected) return;
    setSaving(true);
    const res = await setStaffNotionUserId(staffId, selected);
    setSaving(false);
    if (res.ok) {
      toast.success("Notion 계정을 연결했습니다");
      goMonth(month);
    } else toast.error(res.error);
  }

  // 연동 미설정 — 토큰/DB id 없음(env). 원장에겐 중립 안내(기술 원문 노출 금지).
  if (result.ok && result.state === "not_configured")
    return <Panel title="Notion 연동이 아직 설정되지 않았습니다" desc="관리자가 Notion 업무 DB를 연결하면 이곳에 월간 업무가 표시됩니다." />;

  // 미매핑 — 이 직원에 Notion 계정 미연결. 사무실이면 연결 UI, 아니면 안내.
  if (result.ok && result.state === "unmapped") {
    if (!canManage)
      return <Panel title="Notion 계정이 연결되지 않았습니다" desc="담당자가 이 직원의 Notion 계정을 연결하면 월간 업무가 표시됩니다." />;
    return (
      <div className="bg-card border-line shadow-card rounded-lg border px-5 py-6">
        <h3 className="text-foreground text-[14px] font-semibold">Notion 계정 연결</h3>
        <p className="text-text-faint mt-1 mb-3 text-[12px]">
          이메일이 같으면 자동 연결됩니다. 이메일이 달라 자동 연결되지 않았으니, Notion 담당자를 직접 골라 연결하세요.
        </p>
        {userOptions.length === 0 ? (
          <p className="text-text-faint text-[12px]">Notion 사용자 목록을 불러오지 못했습니다. 연동 설정을 확인해주세요.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <SearchableSelect
              options={userOptions.map((u) => ({ value: u.id, label: u.name, hint: u.email ?? undefined }))}
              value={selected}
              onValueChange={setSelected}
              placeholder="Notion 사용자 선택…"
              ariaLabel="Notion 사용자"
              className="min-w-[220px]"
            />
            <Button size="sm" disabled={!selected || saving} onClick={saveMapping}>
              연결
            </Button>
          </div>
        )}
      </div>
    );
  }

  // 오류 — 한글 요약(원문은 개발용, UI 미노출). 재시도 버튼.
  if (!result.ok)
    return (
      <div className="border-danger/40 bg-danger/5 rounded-lg border px-5 py-6 text-center">
        <p className="text-danger text-[13px] font-medium">{result.error}</p>
        <Button size="sm" variant="outline" className="mt-3" disabled={pending} onClick={() => goMonth(month)}>
          다시 시도
        </Button>
      </div>
    );

  const tasks = result.tasks;
  const weeks = buildMonthGrid(month);

  return (
    <div className="space-y-3">
      {/* 툴바 — 월 이동 + 그리드/리스트 토글 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="이전 달" disabled={pending} onClick={() => goMonth(shiftMonth(month, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-foreground min-w-[92px] text-center text-[14px] font-semibold">{monthLabel(month)}</span>
          <Button size="sm" variant="ghost" aria-label="다음 달" disabled={pending} onClick={() => goMonth(shiftMonth(month, 1))}>
            <ChevronRight className="size-4" />
          </Button>
          <Button size="sm" variant="outline" className="ml-1" disabled={pending} onClick={() => goMonth(today.slice(0, 7))}>
            오늘
          </Button>
          {pending ? <span className="text-text-faint ml-1 text-[11px]">불러오는 중…</span> : null}
        </div>
        <div className="border-line inline-flex overflow-hidden rounded-md border">
          <button
            type="button"
            onClick={() => pickView("grid")}
            aria-pressed={view === "grid"}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[12px] ${view === "grid" ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"}`}
          >
            <LayoutGrid size={13} /> 달력
          </button>
          <button
            type="button"
            onClick={() => pickView("list")}
            aria-pressed={view === "list"}
            className={`border-line inline-flex items-center gap-1 border-l px-2.5 py-1 text-[12px] ${view === "list" ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"}`}
          >
            <List size={13} /> 목록
          </button>
        </div>
      </div>

      {tasks.length === 0 && view === "grid" ? (
        <p className="text-text-faint px-1 pb-1 text-[12px]">이 달에 등록된 업무가 없습니다.</p>
      ) : null}
      {view === "grid" ? (
        <MonthGridView weeks={weeks} tasks={tasks} today={today} onOpen={setOpenTask} />
      ) : (
        <MonthListView tasks={tasks} today={today} onOpen={setOpenTask} />
      )}

      {openTask ? (
        <TaskDetailDialog key={openTask.id} task={openTask} onClose={() => setOpenTask(null)} />
      ) : null}
    </div>
  );
}
