"use client";
import {
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON_PRIMARY,
} from "@/components/toolbar-controls";

// 직원 상세 '월간일정' 탭(Notion 업무, 읽기 전용) — 그리드⇄리스트 토글 + 월 이동 + 미매핑 시 연결 UI.
// 근무일정 탭을 대체(근무시간 편집기는 휴면). 초기 데이터는 서버 탭에서 주입, 월 이동은 서버 액션 재호출.
// ⚠️ 미매핑이면 서버는 즉시 unmapped만 주고(첫 페인트 안 막음, B7), 자동연결·후보는 여기서 지연 호출.
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, List, Plus } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { kstToday } from "@/lib/date-kst";
import { buildMonthGrid, monthLabel, shiftMonth } from "@/lib/month-grid";
import { groupTasksByDate, type NotionTask } from "@/features/staff/notion/notion-tasks";
import {
  getStaffMonthlyTasks,
  prepareNotionMapping,
  setStaffNotionUserId,
  moveTaskDue,
} from "@/features/staff/notion/server/notion-actions";
import type { MonthlyTasksResult, NotionUserOption, TakenMapping } from "@/features/staff/notion/server/notion";
import { MonthGridView } from "./month-grid-view";
import { TaskDetailDialog } from "./task-detail-dialog";
import { DayTasksDialog } from "./day-tasks-dialog";
import { NewTaskDialog } from "./new-task-dialog";

const VIEW_KEY = "eywa-monthly-view";
type ViewMode = "grid" | "list";

// 뷰 선호(달력/목록) — SSR은 항상 "grid"로 그리고 hydration 후 저장값으로 전환(useSyncExternalStore =
// 서버/클라 스냅샷 분리). ⚠️ lazy useState에서 localStorage를 읽으면 서버 HTML과 첫 클라 렌더가 어긋나
// hydration 크래시(#418, 프로덕션 실측 2026-07-13 — 페이지 전체 클릭 먹통)가 난다.
const viewListeners = new Set<() => void>();
function readViewPref(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}
function writeViewPref(v: ViewMode) {
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* localStorage 불가 — 무시 */
  }
  viewListeners.forEach((l) => l());
}
function subscribeViewPref(cb: () => void): () => void {
  viewListeners.add(cb);
  return () => {
    viewListeners.delete(cb);
  };
}

function Panel({ title, desc }: { title: string; desc?: string }) {
  return (
    <EmptyState
      image="staff"
      icon={() => <CalendarDays size={30} strokeWidth={1.8} />}
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
    return <p className="text-text-faint px-1 py-6 text-center text-sm">이 달에 등록된 업무가 없습니다.</p>;
  return (
    <div className="border-line bg-card divide-line divide-y rounded-2xl border">
      {dates.map((d) => (
        <div key={d} className="flex gap-3 px-3 py-2">
          <div className={`num w-16 shrink-0 text-xs ${d === today ? "text-primary font-bold" : "text-text-dim"}`}>
            {d.slice(5).replace("-", "/")}
          </div>
          <div className="flex-1 space-y-0.5">
            {byDate[d]!.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onOpen(t)}
                className="hover:bg-primary/10 hover:text-primary flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-xs transition"
              >
                <span className={t.done ? "text-text-faint line-through" : "text-foreground"}>{t.title}</span>
                {t.dept ? <span className="text-text-faint">· {t.dept}</span> : null}
                {t.start && t.due && t.start !== t.due ? (
                  <span className="text-text-faint num text-xs">({t.start.slice(5)}~{t.due.slice(5)})</span>
                ) : null}
                {t.done ? <span className="text-green text-xs">완료</span> : null}
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
  staffName,
  canManage,
  initialMonth,
  initial,
}: {
  staffId: string;
  staffName: string;
  canManage: boolean;
  initialMonth: string;
  initial: MonthlyTasksResult;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [result, setResult] = useState<MonthlyTasksResult>(initial);
  const [pending, start] = useTransition();
  // 서버 스냅샷은 항상 "grid" → SSR HTML과 첫 클라 렌더 일치(hydration 안전), 이후 저장값 반영.
  const view = useSyncExternalStore(subscribeViewPref, readViewPref, () => "grid" as ViewMode);
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [openTask, setOpenTask] = useState<NotionTask | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [pendingMove, setPendingMove] = useState<{ task: NotionTask; newDue: string } | null>(null);
  const [movingBusy, setMovingBusy] = useState(false);
  // 매핑 준비(지연) — "prepping"=스캔 중(초기), "none"=자동 불가(비사무실), 객체=수동 후보(+이미 연결된 계정 목록).
  const [mapPrep, setMapPrep] = useState<
    "prepping" | "none" | { options: NotionUserOption[]; taken: TakenMapping[] }
  >("prepping");
  const today = kstToday();

  const pickView = writeViewPref;
  function goMonth(next: string) {
    setMonth(next);
    start(async () => setResult(await getStaffMonthlyTasks(staffId, next)));
  }
  const refetch = () => start(async () => setResult(await getStaffMonthlyTasks(staffId, month)));

  // 드래그 이동 → 확인 후 Notion 반영(안전장치).
  async function confirmMove() {
    if (!pendingMove) return;
    const { task, newDue } = pendingMove;
    setMovingBusy(true);
    const res = await moveTaskDue(task.id, newDue, task.start, task.due ?? newDue);
    setMovingBusy(false);
    setPendingMove(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("마감일을 옮겼습니다 · Notion 반영됨");
    refetch();
  }

  // 미매핑이면 화면 표시 후 자동연결·후보 로드를 지연 호출(무거운 담당자 스캔 = 첫 페인트 밖으로).
  // setState는 전부 비동기 콜백 안(#25 — 동기 setState in effect 금지). 초기값이 "prepping"이라 동기 set 불필요.
  const unmapped = result.ok && result.state === "unmapped";
  useEffect(() => {
    if (!unmapped) return;
    let alive = true;
    prepareNotionMapping(staffId).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setMapPrep("none");
        toast.error(res.error);
      } else if (res.prep.state === "matched") {
        start(async () => setResult(await getStaffMonthlyTasks(staffId, month)));
      } else if (res.prep.state === "options") {
        setMapPrep({ options: res.prep.options, taken: res.prep.taken });
      } else {
        setMapPrep("none");
      }
    });
    return () => {
      alive = false;
    };
    // month는 재조회 시점 값만 쓰면 되므로 의존성에서 제외(월 이동마다 스캔 재시도 방지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unmapped, staffId]);
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

  // 미매핑 — 화면은 즉시 뜨고, 자동연결/후보는 백그라운드(지연)로.
  if (unmapped) {
    if (mapPrep === "prepping")
      return (
        <Panel
          title="Notion 계정 확인 중…"
          desc="업무 담당자 정보를 불러와 이메일로 자동 연결을 시도하고 있습니다. 잠시만 기다려주세요."
        />
      );
    if (mapPrep === "none" || !canManage)
      return <Panel title="Notion 계정이 연결되지 않았습니다" desc="담당자가 이 직원의 Notion 계정을 연결하면 월간 업무가 표시됩니다." />;
    return (
      <div className="bg-card border-line shadow-card rounded-2xl border px-5 py-6">
        <h3 className="text-foreground text-sm font-bold">Notion 계정 연결</h3>
        <p className="text-text-faint mt-1 mb-3 text-xs">
          이메일이 같으면 자동 연결됩니다. 이메일이 달라 자동 연결되지 않았으니, Notion 담당자를 직접 골라 연결하세요.
          <br />
          이미 다른 직원에 연결된 계정은 목록에서 제외됩니다(중복 연결 방지).
        </p>
        {mapPrep.options.length === 0 ? (
          <p className="text-text-faint text-xs">
            연결 가능한 Notion 담당자가 없습니다{mapPrep.taken.length > 0 ? " (후보 전원이 이미 다른 직원에 연결됨)" : " — 연동 설정을 확인해주세요"}.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <SearchableSelect
              options={mapPrep.options.map((u) => ({ value: u.id, label: u.name, hint: u.email ?? undefined }))}
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
        {mapPrep.taken.length > 0 ? (
          <p className="text-text-faint mt-3 text-xs">
            이미 연결됨: {mapPrep.taken.map((t) => `${t.notionName}→${t.staffName}`).join(", ")}
          </p>
        ) : null}
      </div>
    );
  }

  // 오류 — 한글 요약(원문은 개발용, UI 미노출). 재시도 버튼.
  if (!result.ok)
    return (
      <div className="border-danger/40 bg-danger/5 rounded-2xl border px-5 py-6 text-center">
        <p className="text-danger text-sm font-medium">{result.error}</p>
        <Button size="sm" variant="outline" className="mt-3" disabled={pending} onClick={() => goMonth(month)}>
          다시 시도
        </Button>
      </div>
    );

  // 여기 도달 = state "ok"(위에서 unmapped/not_configured/error 전부 반환). state로 직접 좁혀 tasks 접근.
  const tasks = result.state === "ok" ? result.tasks : [];
  const weeks = buildMonthGrid(month);

  return (
    <div className="space-y-3">
      {/* 툴바 — 월 이동 + 그리드/리스트 토글 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" aria-label="이전 달" disabled={pending} onClick={() => goMonth(shiftMonth(month, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-foreground min-w-[92px] text-center text-sm font-bold">{monthLabel(month)}</span>
          <Button variant="ghost" aria-label="다음 달" disabled={pending} onClick={() => goMonth(shiftMonth(month, 1))}>
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" className="ml-1" disabled={pending} onClick={() => goMonth(today.slice(0, 7))}>
            오늘
          </Button>
          {pending ? <span className="text-text-faint ml-1 text-xs">불러오는 중…</span> : null}
        </div>
        <div className="flex items-center gap-2">
          {canManage ? (
            <Button variant="outline" onClick={() => setOpenNew(true)}>
              <Plus className="size-3.5" /> 새 업무
            </Button>
          ) : null}
          <div className={TOOLBAR_SEG_BOX}>
            <button
              type="button"
              onClick={() => pickView("grid")}
              aria-pressed={view === "grid"}
              className={`${TOOLBAR_SEG_ITEM} inline-flex items-center gap-1 ${view === "grid" ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
            >
              <LayoutGrid size={13} /> 달력
            </button>
            <button
              type="button"
              onClick={() => pickView("list")}
              aria-pressed={view === "list"}
              className={`${TOOLBAR_SEG_ITEM} inline-flex items-center gap-1 ${view === "list" ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
            >
              <List size={13} /> 목록
            </button>
          </div>
        </div>
      </div>
      {canManage ? (
        <p className="text-text-faint px-1 text-xs">달력에서 업무 막대를 다른 날짜로 끌어 마감일을 옮길 수 있습니다(확인 후 Notion 반영).</p>
      ) : null}

      {tasks.length === 0 && view === "grid" ? (
        <p className="text-text-faint px-1 pb-1 text-xs">이 달에 등록된 업무가 없습니다.</p>
      ) : null}
      {view === "grid" ? (
        <MonthGridView
          weeks={weeks}
          tasks={tasks}
          today={today}
          onOpen={setOpenTask}
          onOpenDay={setOpenDay}
          canEdit={canManage}
          onMove={(task, newDue) => setPendingMove({ task, newDue })}
        />
      ) : (
        <MonthListView tasks={tasks} today={today} onOpen={setOpenTask} />
      )}

      {/* 그날 전체 목록 → 항목 클릭 시 상세로 전환 */}
      {openDay ? (
        <DayTasksDialog
          key={openDay}
          date={openDay}
          tasks={tasks}
          onPick={(t) => {
            setOpenDay(null);
            setOpenTask(t);
          }}
          onClose={() => setOpenDay(null)}
        />
      ) : null}

      {openTask ? (
        <TaskDetailDialog
          key={openTask.id}
          task={openTask}
          canEdit={canManage}
          onChanged={refetch}
          onClose={() => setOpenTask(null)}
        />
      ) : null}

      {openNew ? (
        <NewTaskDialog
          staffId={staffId}
          staffName={staffName}
          defaultDue={today}
          onCreated={refetch}
          onClose={() => setOpenNew(false)}
        />
      ) : null}

      {/* 드래그 이동 확인 — Notion 반영 안전장치 */}
      <ConfirmDialog
        open={!!pendingMove}
        title="마감일 이동"
        message={
          pendingMove
            ? `"${pendingMove.task.title}"의 마감일을 ${pendingMove.newDue}(으)로 옮기면 Notion에도 반영됩니다.${
                pendingMove.task.start && pendingMove.task.due && pendingMove.task.start !== pendingMove.task.due
                  ? " 기간 업무라 시작일도 함께 이동합니다."
                  : ""
              } 진행할까요?`
            : ""
        }
        confirmLabel="이동"
        onConfirm={confirmMove}
        onCancel={() => (movingBusy ? null : setPendingMove(null))}
      />
    </div>
  );
}
