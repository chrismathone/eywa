"use client";

// ECS 주간 시트 오케스트레이터 — state 소유·저장 큐·저널·presence·네비 flush.
// 페이지가 key={classId:week}로 재마운트하므로 서버 데이터로 state가 재초기화된다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEditPresence } from "@/features/presence/edit-presence";
import type { ClassSheetWeekData } from "../server/queries";
import {
  clearPresentAttendance,
  deletePlanLine as deletePlanLineAction,
  createPlanLine as createPlanLineAction,
  flushSheetPatches,
  markPresentIfAbsent,
  movePlanLine as movePlanLineAction,
  saveMemo,
  setMyEcsFontSize,
  setMyEcsShowSpecialRooms,
  upsertGoal,
  upsertStudentMark,
  type PlanLineDTO,
} from "../server/actions";
import { ECS_FONT_SIZE_ZOOM, type EcsFontSize } from "../font-size";
import { buildSaveKey, type PlanFieldPatch } from "../lib/save-keys";
import { PLAN_PATCH_FIELDS, isMeaningfulPlanLine } from "../lib/plan-codec";
import { useSheetDoc } from "./use-sheet-doc";
import { useFlushOnUnmount, useSheetSaveStore } from "./use-sheet-saves";
import { SheetToolbar } from "./sheet-toolbar";
import { PlanPanel } from "./plan-panel";
import { SheetGrid } from "./sheet-grid";
import { CopyPrevWeek } from "./copy-prev-week";
import { ClassSheetImportButton } from "./class-import-button";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";

export type SheetHandlers = {
  editCell: (lineId: string, field: (typeof PLAN_PATCH_FIELDS)[number], value: string) => void;
  resolveConflict: (saveKey: string, choice: "server" | "mine") => void;
  addLine: (planDate: string, slotStart: string, termMode: "regular" | "exam", skillArea: string) => void;
  removeLine: (lineId: string, planDate: string, slotStart: string) => void;
  moveLineTerm: (lineId: string, planDate: string, slotStart: string, termMode: "regular" | "exam") => void;
  markPresent: (studentId: string, date: string) => void;
  clearAttendance: (studentId: string, date: string) => void;
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
  // 마크 롤백용 직전 값 미러(저장 실패 시 낙관 반영을 되돌린다)
  const marksRef = useRef(marks);
  useEffect(() => {
    marksRef.current = marks;
  }, [marks]);

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

  // ── 글씨 크기(내 계정) ─────────────────────────────────────────────────────
  // 서버 확정값으로 시작(첫 렌더부터 정확 — localStorage 초기값은 하이드레이션 크래시 #75).
  // 화면은 **즉시** 바꾸고 계정 저장은 뒤따른다(반응속도 1순위). 저장 실패해도 이번 세션 크기는 유지.
  const [fontSize, setFontSize] = useState<EcsFontSize>(data.fontSize);
  const changeFontSize = useCallback((size: EcsFontSize) => {
    setFontSize(size);
    void setMyEcsFontSize(size).then((r) => {
      if (!r.ok) toast.error("글씨 크기를 계정에 저장하지 못했습니다 — 이 화면에서는 적용됩니다");
    });
  }, []);
  const fontZoom = ECS_FONT_SIZE_ZOOM[fontSize];

  // ── 자리(LAB·JJ) 표시(내 계정) ─────────────────────────────────────────────
  // 글씨 크기와 달리 **서버가 진실**이다 — 이 값이 그리드와 작성률(헤더 `계획 N/M교시`·랜딩 카드)을 함께
  // 정하므로 클라에서 감추면 숫자가 갈린다. 저장 → refresh로 서버가 다시 그린다(페이지 key에 이 값이
  // 들어 있어 SheetClient가 재마운트되고 state가 새 데이터로 재초기화된다).
  // ⚠️ 왕복 전에 flush — 안 하면 아직 확정 안 된 입력이 재마운트로 날아간다(네비와 같은 계약).
  const [specialRoomsPending, setSpecialRoomsPending] = useState(false);
  const changeShowSpecialRooms = useCallback(
    async (show: boolean) => {
      if (show === data.showSpecialRooms || specialRoomsPending) return;
      setSpecialRoomsPending(true);
      try {
        const flushed = await store.flush();
        if (!flushed.ok) {
          const go = window.confirm(
            "아직 저장이 확정되지 않은 입력(또는 충돌)이 있습니다. 그래도 표시를 바꿀까요? (입력은 이 기기에 보관됩니다)",
          );
          if (!go) return;
        }
        const r = await setMyEcsShowSpecialRooms(show);
        if (!r.ok) {
          toast.error(r.error ?? "표시 설정을 저장하지 못했습니다");
          return;
        }
        router.refresh();
      } finally {
        setSpecialRoomsPending(false);
      }
    },
    [data.showSpecialRooms, router, specialRoomsPending, store],
  );

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

  // ── 시트 가져오기(이 반만) — 반영 직전 flush ───────────────────────────────
  // 가져오기는 시트가 채운 교시를 **교체**하므로, 아직 확정 안 된 내 입력이 큐에 남아 있으면
  // 그 입력이 가져오기 뒤에 덮어써 "시트를 가져왔는데 옛 값이 되살아나는" 순서 뒤집힘이 난다.
  // 이동(navigate)과 같은 계약: flush 실패·미확정이면 사람이 고른다.
  const flushBeforeImport = useCallback(async () => {
    const r = await store.flush();
    if (r.ok) return true;
    return window.confirm(
      "아직 저장이 확정되지 않은 입력(또는 충돌)이 있습니다. 그래도 시트 내용을 가져올까요? (입력은 이 기기에 보관됩니다)",
    );
  }, [store]);

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
      // 체크를 다시 누르면 취소(0169a). 서버가 거부하는 경우(결석·지각·출석부 메모/시수)는 낙관 반영을
      // 되돌리고 사유를 띄운다 — "지워진 것처럼 보였다가 새로고침하면 돌아오는" 거짓 성공을 막는다.
      clearAttendance: (studentId, date) => {
        if (!data.canMarkAttendanceByDate[date]) return;
        const key = `${studentId}|${date}`;
        let before: string | undefined;
        setAttendance((prev) => {
          before = prev[key];
          const next = { ...prev };
          delete next[key];
          return next;
        });
        void clearPresentAttendance({ classId, studentId, date }).then((r) => {
          if (!r.ok) {
            setAttendance((prev) => (before === undefined ? prev : { ...prev, [key]: before }));
            toast.error(r.error);
          }
        });
      },
      saveMark: (studentId, date, slotStart, status, note) => {
        const key = `${studentId}|${date}|${slotStart}`;
        // 실패 시 되돌릴 직전 값 — 낙관 반영만 하고 롤백이 없으면 화면엔 남고 서버엔 없는 상태가 되어
        // 툴바가 "저장됨"이라 말하는 동안 강사는 입력을 잃는다(적대검증 2026-07-29). 출석과 같은 처방.
        const before = marksRef.current[key] ?? null;
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
          if (!r.ok) {
            setMarks((prev) => {
              const next = { ...prev };
              if (before) next[key] = before;
              else delete next[key];
              return next;
            });
            toast.error(r.error);
          }
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
        // 목표는 행 단위 LWW라 직전 값 복원이 다른 필드를 되돌릴 수 있다 → 롤백 대신 **명시 고지**
        // (조용히 "저장됨"으로 넘어가지 않게. 새로고침하면 서버 값이 진실이다.)
        if (!r.ok) toast.error(`${r.error} — 저장되지 않았습니다(새로고침하면 이전 값으로 돌아갑니다)`);
      });
    },
    [classId, data.monthStart, store, weekMonday],
  );

  const saveWeekMemo = useCallback(
    (memoKey: string, body: string) => {
      setMemos((prev) => ({ ...prev, [memoKey]: body }));
      store.scheduleLww(`memo:${memoKey}`, async () => {
        const r = await saveMemo({ classId, weekStart: weekMonday, memoKey, body });
        if (!r.ok) toast.error(`${r.error} — 저장되지 않았습니다`);
      });
    },
    [classId, store, weekMonday],
  );

  const visibleDays = dayFilter ? data.grid.days.filter((d) => d.date === dayFilter) : data.grid.days;
  // "이 주는 아직 비어 있어요"는 **현재 화면 상태**로 판정한다. 서버 스냅샷(data.fill)만 보면 계획 셀
  // 저장이 RSC를 갱신하지 않으므로(서버 액션에 revalidate 없음·같은 주에선 재마운트 없음) 강사가 그 주를
  // 다 채워도 채워진 표 바로 위에 "비어 있어요"가 계속 뜬다(적대검증 2026-07-29, 첫 사용 시 100% 발생).
  const weekIsEmpty = useMemo(
    () =>
      data.fill.filledSlots === 0 &&
      !Object.values(linesBySlot).some((lines) => lines.some((l) => isMeaningfulPlanLine(l))),
    [data.fill.filledSlots, linesBySlot],
  );

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
        fontSize={fontSize}
        onFontSize={changeFontSize}
        showSpecialRooms={data.showSpecialRooms}
        onShowSpecialRooms={(show) => void changeShowSpecialRooms(show)}
        specialRoomsPending={specialRoomsPending}
        trailing={
          data.showSheetImport ? (
            <ClassSheetImportButton
              classId={classId}
              className={data.className}
              beforeApply={flushBeforeImport}
            />
          ) : null
        }
      />

      {doc.recoverable ? (
        <div className="border-line bg-bg-soft flex flex-wrap items-center gap-2 rounded-2xl border border-dashed px-4 py-2.5 text-[13px]">
          <span className="text-foreground">
            이전에 저장되지 못한 입력 {doc.recoverable.mutations.length}건이 이 기기에 남아 있습니다.
          </span>
          <button
            type="button"
            className="text-primary cursor-pointer font-bold underline-offset-2 hover:underline"
            onClick={() => void applyRecovered()}
          >
            복구해서 저장
          </button>
          <button type="button" className="text-text-faint hover:text-foreground cursor-pointer" onClick={doc.dismissRecoverable}>
            무시
          </button>
        </div>
      ) : null}

      {canEdit && weekIsEmpty ? <CopyPrevWeek classId={classId} weekMonday={weekMonday} weekLabelText={data.weekLabel} /> : null}

      {/* 글씨 크기 — 계획 패널 + 주간 그리드만 감싼다(상단 바는 그대로: 크기를 고르는 컨트롤이 같이
          커지면 어지럽다). ⚠️ font-size가 아니라 zoom인 이유는 font-size.ts 주석 참조(열 폭이 px 고정인 표).
          기본('작음')은 배율 1이라 **스타일 자체를 안 붙인다** — 손대지 않은 사용자의 렌더는 완전 무변경. */}
      <div
        className="flex min-h-0 flex-1 items-stretch gap-3"
        style={fontZoom === 1 ? undefined : { zoom: fontZoom }}
      >
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

      {/* 상단 'LAB·JJ 숨김'을 골랐을 때만 뜬다 — 안 그린 자리에 쓴 기록이 남아 있으면 건수를 알린다.
          화면에서 조용히 사라지면 "쓴 게 증발했다"가 된다(기록은 DB에 그대로, 표시로 되돌리면 다시 보인다). */}
      {data.grid.hiddenSpecial.records > 0 ? (
        <p className="text-text-dim px-1 text-[12px]">
          LAB·JJ 교시 {data.grid.hiddenSpecial.slots}개를 숨겼습니다 — 그 시간에 남아 있는 기록{" "}
          {data.grid.hiddenSpecial.records}건은 지워지지 않았습니다(상단 ‘표시’로 다시 볼 수 있습니다).
        </p>
      ) : null}
    </div>
  );
}

/** 계획 셀 saveKey 헬퍼 — 하위 컴포넌트 공용. */
export function cellKey(lineId: string, field: (typeof PLAN_PATCH_FIELDS)[number]): string {
  return buildSaveKey(lineId, field);
}
