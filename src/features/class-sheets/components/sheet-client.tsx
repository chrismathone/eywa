"use client";

// ECS 주간 시트 오케스트레이터 — state 소유·저장 큐·저널·presence·네비 flush.
// 페이지가 key={classId:week}로 재마운트하므로 서버 데이터로 state가 재초기화된다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEditPresence } from "@/features/presence/edit-presence";
import type { ClassSheetWeekData } from "../server/queries";
import {
  deletePlanLine as deletePlanLineAction,
  createPlanLine as createPlanLineAction,
  flushSheetPatches,
  markPresentIfAbsent,
  movePlanLine as movePlanLineAction,
  saveMemo,
  upsertGoal,
  upsertStudentMark,
  type PlanLineDTO,
} from "../server/actions";
import { buildSaveKey, type PlanFieldPatch } from "../lib/save-keys";
import { PLAN_PATCH_FIELDS } from "../lib/plan-codec";
import { useSheetDoc } from "./use-sheet-doc";
import { useFlushOnUnmount, useSheetSaveStore } from "./use-sheet-saves";
import { SheetToolbar } from "./sheet-toolbar";
import { PlanPanel } from "./plan-panel";
import { SheetGrid } from "./sheet-grid";
import { CopyPrevWeek } from "./copy-prev-week";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";

export type SheetHandlers = {
  editCell: (lineId: string, field: (typeof PLAN_PATCH_FIELDS)[number], value: string) => void;
  resolveConflict: (saveKey: string, choice: "server" | "mine") => void;
  addLine: (planDate: string, slotStart: string, termMode: "regular" | "exam", skillArea: string) => void;
  removeLine: (lineId: string, planDate: string, slotStart: string) => void;
  moveLineTerm: (lineId: string, planDate: string, slotStart: string, termMode: "regular" | "exam") => void;
  markPresent: (studentId: string, date: string) => void;
  saveMark: (studentId: string, date: string, slotStart: string, status: string | null, note: string | null) => void;
};

export function SheetClient({
  data,
  classOptions,
  userId,
  tenantId,
}: {
  data: ClassSheetWeekData;
  classOptions: { id: string; name: string }[];
  userId: string;
  tenantId: string;
}) {
  const router = useRouter();
  const { classId, weekMonday } = data;
  const canEdit = data.canWrite;

  // ── 저널·저장 큐 ───────────────────────────────────────────────────────────
  const doc = useSheetDoc({ tenantId, userId, classId, week: weekMonday });
  const send = useCallback(
    (patches: PlanFieldPatch[]) => flushSheetPatches(classId, patches),
    [classId],
  );
  const store = useSheetSaveStore(send, doc.journal, canEdit);
  useFlushOnUnmount(store);
  useEffect(() => {
    store.setCallbacks({
      onError: (m) => toast.error(m),
      onGone: () => toast.info("다른 사용자가 이 줄을 삭제했습니다 — 새로고침해 최신 상태를 확인하세요"),
    });
  }, [store]);

  // presence — 팀티칭 동시편집은 정상(중립 톤). 충돌 방지는 CAS가 담당.
  useEditPresence(`ecs:${classId}:${weekMonday}`, canEdit);

  // ── 계획 행 구조 state(슬롯별) — RPC 응답의 canonical 행으로 동기화 ────────
  const initialLines = useMemo(() => {
    const map: Record<string, PlanLineDTO[]> = {};
    for (const day of data.grid.days) {
      for (const slot of day.slots) {
        map[`${day.date}|${slot.slotStart}`] = slot.lines.map((l) => ({
          id: l.id,
          planDate: l.planDate,
          slotStart: slot.slotStart,
          termMode: l.termMode,
          skillArea: l.skillArea,
          lineNo: l.lineNo,
          textbook: l.textbook,
          pageRange: l.pageRange,
          progress: l.progress,
          homework: l.homework,
          updatedAt: l.updatedAt,
        }));
      }
    }
    return map;
  }, [data.grid]);
  const [linesBySlot, setLinesBySlot] = useState(initialLines);

  // CAS 셀 canonical 시드(텍스트 필드 + skill_area)
  useEffect(() => {
    for (const lines of Object.values(initialLines)) {
      for (const l of lines) {
        store.seed(l.id, "textbook", l.textbook);
        store.seed(l.id, "page_range", l.pageRange);
        store.seed(l.id, "progress", l.progress);
        store.seed(l.id, "homework", l.homework);
        store.seed(l.id, "skill_area", l.skillArea);
      }
    }
  }, [initialLines, store]);

  // ── 마크·출석 공유 상태 ────────────────────────────────────────────────────
  const [marks, setMarks] = useState(data.marks);
  const [attendance, setAttendance] = useState(data.attendanceByStudentDate);
  const [goals, setGoals] = useState(data.goals);
  const [memos, setMemos] = useState(data.memos);
  // LWW 저장이 디바운스 발화 시점의 **최신** 로컬 값을 읽도록 ref 미러(render 중 ref 접근 금지 — effect 갱신)
  const goalsRef = useRef(goals);
  useEffect(() => {
    goalsRef.current = goals;
  }, [goals]);

  // ── 요일 필터(같은 주 전환 = flush·재조회 없이 History API) ────────────────
  const [dayFilter, setDayFilter] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("day");
  });
  const changeDayFilter = useCallback((day: string | null) => {
    setDayFilter(day);
    const url = new URL(window.location.href);
    if (day) url.searchParams.set("day", day);
    else url.searchParams.delete("day");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const [panelOpen, setPanelOpen] = useState(true);

  // ── 네비(주/반 이동) — flush 성공 후에만 이동, 실패·미확정 시 중단(저널 보존) ─
  const navigate = useCallback(
    async (href: string) => {
      const r = await store.flush();
      if (!r.ok) {
        const go = window.confirm(
          "아직 저장이 확정되지 않은 입력(또는 충돌)이 있습니다. 그래도 이동할까요? (입력은 이 기기에 보관됩니다)",
        );
        if (!go) return;
      }
      router.push(href);
    },
    [router, store],
  );

  // ── 저널 복구 배너 적용 ────────────────────────────────────────────────────
  const applyRecovered = useCallback(async () => {
    const muts = await doc.claimRecoverable();
    if (muts.length === 0) return;
    for (const m of muts) {
      const p = m.patch;
      store.seed(p.lineId, p.field, p.expectedValue);
      store.edit(p.lineId, p.field, p.newValue ?? "");
    }
    toast.info(`미저장 입력 ${muts.length}건을 복구해 다시 저장합니다`);
  }, [doc, store]);

  // ── 핸들러(객체 ref 고정 — memoized row의 안정 콜백) ──────────────────────
  const handlers: SheetHandlers = useMemo(
    () => ({
      editCell: (lineId, field, value) => store.edit(lineId, field, value),
      resolveConflict: (saveKey, choice) => store.resolveConflict(saveKey, choice),
      addLine: (planDate, slotStart, termMode, skillArea) => {
        void createPlanLineAction({ classId, planDate, slotStart, termMode, skillArea }).then((r) => {
          if (!r.ok) return toast.error(r.error);
          setLinesBySlot((prev) => ({ ...prev, [`${planDate}|${slotStart}`]: r.lines }));
          for (const l of r.lines) {
            store.seed(l.id, "textbook", l.textbook);
            store.seed(l.id, "page_range", l.pageRange);
            store.seed(l.id, "progress", l.progress);
            store.seed(l.id, "homework", l.homework);
            store.seed(l.id, "skill_area", l.skillArea);
          }
        });
      },
      removeLine: (lineId, planDate, slotStart) => {
        void deletePlanLineAction({ classId, lineId }).then((r) => {
          if (!r.ok) return toast.error(r.error);
          setLinesBySlot((prev) => ({ ...prev, [`${planDate}|${slotStart}`]: r.lines }));
        });
      },
      moveLineTerm: (lineId, planDate, slotStart, termMode) => {
        void movePlanLineAction({ classId, lineId, termMode, lineNo: 99 }).then((r) => {
          if (!r.ok) return toast.error(r.error);
          setLinesBySlot((prev) => ({ ...prev, [`${planDate}|${slotStart}`]: r.lines }));
        });
      },
      markPresent: (studentId, date) => {
        if (!data.canMarkAttendanceByDate[date]) return;
        // 낙관적 반영 → 실패 롤백
        setAttendance((prev) => ({ ...prev, [`${studentId}|${date}`]: prev[`${studentId}|${date}`] ?? "present" }));
        void markPresentIfAbsent({ classId, studentId, date }).then((r) => {
          if (!r.ok) {
            setAttendance((prev) => {
              const next = { ...prev };
              if (next[`${studentId}|${date}`] === "present") delete next[`${studentId}|${date}`];
              return next;
            });
            toast.error(r.error);
            return;
          }
          setAttendance((prev) => ({ ...prev, [`${studentId}|${date}`]: r.status }));
        });
      },
      saveMark: (studentId, date, slotStart, status, note) => {
        const key = `${studentId}|${date}|${slotStart}`;
        setMarks((prev) => ({ ...prev, [key]: { status, progressNote: note } }));
        store.scheduleLww(`mark:${key}`, async () => {
          const r = await upsertStudentMark({
            classId,
            studentId,
            markDate: date,
            slotStart,
            status,
            progressNote: note,
          });
          if (!r.ok) toast.error(r.error);
        });
      },
    }),
    [classId, data.canMarkAttendanceByDate, store],
  );

  const saveGoal = useCallback(
    (scope: "month" | "week", role: "homeroom" | "assistant", skillArea: string, field: "textbook" | "targetProgress", value: string) => {
      const periodStart = scope === "week" ? weekMonday : data.monthStart;
      setGoals((prev) => {
        const idx = prev.findIndex(
          (g) => g.scope === scope && g.role === role && g.skillArea === skillArea && g.periodStart === periodStart,
        );
        const base =
          idx >= 0
            ? prev[idx]
            : { scope, periodStart, role, skillArea, textbook: null, targetProgress: null };
        const next = { ...base, [field]: value === "" ? null : value };
        const out = [...prev];
        if (idx >= 0) out[idx] = next;
        else out.push(next);
        return out;
      });
      store.scheduleLww(`goal:${scope}:${role}:${skillArea}`, async () => {
        // 최신 로컬 상태로 upsert(LWW) — 행 단위 저장이라 교재·목표를 함께 커밋(필드별 유실 방지)
        const g = goalsRef.current.find(
          (x) => x.scope === scope && x.role === role && x.skillArea === skillArea && x.periodStart === periodStart,
        );
        const r = await upsertGoal({
          classId,
          scope,
          periodStart,
          role,
          skillArea,
          textbook: g?.textbook ?? null,
          targetProgress: g?.targetProgress ?? null,
        });
        if (!r.ok) toast.error(r.error);
      });
    },
    [classId, data.monthStart, store, weekMonday],
  );

  const saveWeekMemo = useCallback(
    (memoKey: string, body: string) => {
      setMemos((prev) => ({ ...prev, [memoKey]: body }));
      store.scheduleLww(`memo:${memoKey}`, async () => {
        const r = await saveMemo({ classId, weekStart: weekMonday, memoKey, body });
        if (!r.ok) toast.error(r.error);
      });
    },
    [classId, store, weekMonday],
  );

  const visibleDays = dayFilter ? data.grid.days.filter((d) => d.date === dayFilter) : data.grid.days;
  const weekIsEmpty = data.fill.filledSlots === 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <SheetToolbar
        data={data}
        classOptions={classOptions}
        store={store}
        dayFilter={dayFilter}
        onDayFilter={changeDayFilter}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        onNavigate={navigate}
      />

      {doc.recoverable ? (
        <div className="border-line bg-bg-soft flex flex-wrap items-center gap-2 rounded-2xl border border-dashed px-4 py-2.5 text-[13px]">
          <span className="text-foreground">
            이전에 저장되지 못한 입력 {doc.recoverable.mutations.length}건이 이 기기에 남아 있습니다.
          </span>
          <button type="button" className="text-primary font-bold underline-offset-2 hover:underline" onClick={() => void applyRecovered()}>
            복구해서 저장
          </button>
          <button type="button" className="text-text-faint hover:text-foreground" onClick={doc.dismissRecoverable}>
            무시
          </button>
        </div>
      ) : null}

      {canEdit && weekIsEmpty ? <CopyPrevWeek classId={classId} weekMonday={weekMonday} weekLabelText={data.weekLabel} /> : null}

      <div className="flex min-h-0 flex-1 items-stretch gap-3">
        {panelOpen ? (
          <PlanPanel
            goals={goals}
            skillAreas={data.skillAreas}
            canEdit={canEdit}
            monthStart={data.monthStart}
            weekMonday={weekMonday}
            memo={memos["panel"] ?? ""}
            onGoalField={saveGoal}
            onMemo={(body) => saveWeekMemo("panel", body)}
          />
        ) : null}
        <DragScrollArea barX className="min-w-0 flex-1">
          {/* 같은 교시 블록이 요일 간 같은 행에 정렬(행 높이 통일) — 카드 크기 맞춤 */}
          <SheetGrid
            days={visibleDays}
            data={data}
            linesBySlot={linesBySlot}
            marks={marks}
            attendance={attendance}
            store={store}
            handlers={handlers}
            canEdit={canEdit}
          />
        </DragScrollArea>
      </div>

      {data.grid.attendanceOnly.length > 0 ? (
        <div className="bg-card shadow-card rounded-2xl px-4 py-3 text-[13px]">
          <p className="text-text-dim">
            수업 시간표가 없는 날짜의 출석 기록:{" "}
            {data.grid.attendanceOnly
              .map((a) => `${a.date} (${a.studentIds.map((id) => data.students[id]?.name ?? "?").join(", ")})`)
              .join(" · ")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** 계획 셀 saveKey 헬퍼 — 하위 컴포넌트 공용. */
export function cellKey(lineId: string, field: (typeof PLAN_PATCH_FIELDS)[number]): string {
  return buildSaveKey(lineId, field);
}
