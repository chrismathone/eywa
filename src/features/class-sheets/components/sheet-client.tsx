"use client";

// ECS 주간 시트 오케스트레이터 — state 소유·저장 큐·저널·presence·네비 flush.
// 페이지가 key={classId:week}로 재마운트하므로 서버 데이터로 state가 재초기화된다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEditPresence } from "@/features/presence/edit-presence";
import type { ClassSheetWeekData } from "../server/queries";
// 출결 저장은 ECS 전용 액션을 만들지 않고 **출석부·원스크린과 같은 것**을 쓴다 — 권한·담당 반·7일 창
// 게이트를 화면마다 다시 짜면 한쪽만 느슨해진다(#77).
// ⚠️ 대신 그 액션의 담당 반 판정이 ECS 접근 범위보다 **좁다**(부담임 제외) → 서버가 거절할 사람에겐
//    queries.ts가 `canMarkAttendanceByDate`를 false로 내려 컨트롤을 미리 잠근다(거짓 어포던스 금지).
import { setAttendanceCell } from "@/features/attendance/server/actions";
import { parseSessionUnits } from "@/features/attendance/session-units";
import {
  clearPresentAttendance,
  deletePlanLine as deletePlanLineAction,
  copySlotFromPrevious,
  createPlanLine as createPlanLineAction,
  flushSheetPatches,
  movePlanLine as movePlanLineAction,
  saveMemo,
  setMyEcsCollapsedRosterGroups,
  setMyEcsFontSize,
  setMyEcsShowSelfStudy,
  upsertGoal,
  upsertStudentMark,
  type PlanLineDTO,
} from "../server/actions";
import { ECS_FONT_SIZE_ZOOM, type EcsFontSize } from "../font-size";
import type { RosterGroupKey } from "../lib/roster-order";
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
  editCell: (
    lineId: string,
    field: (typeof PLAN_PATCH_FIELDS)[number],
    value: string,
  ) => void;
  resolveConflict: (saveKey: string, choice: "server" | "mine") => void;
  addLine: (
    planDate: string,
    slotStart: string,
    termMode: "regular" | "exam",
    skillArea: string,
  ) => void;
  copySlot: (
    planDate: string,
    slotStart: string,
    termMode: "regular" | "exam",
  ) => void;
  removeLine: (lineId: string, planDate: string, slotStart: string) => void;
  moveLineTerm: (
    lineId: string,
    planDate: string,
    slotStart: string,
    termMode: "regular" | "exam",
  ) => void;
  /**
   * 출결 저장(출석/지각/결석) — 원스크린·출석부와 **같은 서버 액션**(`setAttendanceCell`)을 쓴다.
   * 🔴 결석이 찍히면 시수·급여에 닿는다. 그래서 게이트를 ECS가 따로 만들지 않고 그 액션을 그대로 통과시킨다
   *    (권한·담당 반·강사 7일 창 — #77 "UI 조건은 게이트가 아니다").
   * ⚠️ `note`는 **넘길 때만** 갱신된다(undefined면 서버가 기존 사유를 유지) — 출석 pill이 사유를 지우지 않게.
   */
  setAttendance: (
    studentId: string,
    date: string,
    status: "present" | "late" | "absent",
    note?: string | null,
    /** 시수(유닛) raw 입력 — **넘길 때만** 갱신된다(안 넘기면 서버가 기존 값 유지, 자동 주입 없음). */
    units?: string,
  ) => void;
  /**
   * 출결 '선택 안 함' — 드롭다운에만 있는 지우기. **plain present만** 지워진다(0169a `ecs_clear_present`).
   * 사유·시수가 붙은 기록이나 결석·지각은 서버가 거절하고 사유를 띄운다 — 화면에서 지워진 것처럼
   * 보였다가 새로고침하면 돌아오는 거짓 성공을 만들지 않는다.
   */
  clearAttendance: (studentId: string, date: string) => void;
  saveMark: (
    studentId: string,
    date: string,
    slotStart: string,
    status: string | null,
    note: string | null,
  ) => void;
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
      onGone: () =>
        toast.info(
          "다른 사용자가 이 줄을 삭제했습니다 — 새로고침해 최신 상태를 확인하세요",
        ),
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
  // 출결도 같은 이유로 미러 — 핸들러가 useMemo로 고정돼 있어 클로저의 attendance는 낡는다(롤백이 옛 값을
  // 되살리면 "실패했는데 화면은 그대로"가 된다).
  const attendanceRef = useRef(attendance);
  useEffect(() => {
    attendanceRef.current = attendance;
  }, [attendance]);

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
      if (!r.ok)
        toast.error(
          "글씨 크기를 계정에 저장하지 못했습니다 — 이 화면에서는 적용됩니다",
        );
    });
  }, []);
  const fontZoom = ECS_FONT_SIZE_ZOOM[fontSize];

  // ── JJ 표시(내 계정) ───────────────────────────────────────────────────────
  // 글씨 크기와 달리 **서버가 진실**이다 — 이 값이 그리드와 작성률(헤더 `계획 N/M교시`·랜딩 카드)을 함께
  // 정하므로 클라에서 감추면 숫자가 갈린다. 저장 → refresh로 서버가 다시 그린다(페이지 key에 이 값이
  // 들어 있어 SheetClient가 재마운트되고 state가 새 데이터로 재초기화된다).
  // ⚠️ 왕복 전에 flush — 안 하면 아직 확정 안 된 입력이 재마운트로 날아간다(네비와 같은 계약).
  const [selfStudyPending, setSelfStudyPending] = useState(false);
  const changeShowSelfStudy = useCallback(
    async (show: boolean) => {
      if (show === data.showSelfStudy || selfStudyPending) return;
      setSelfStudyPending(true);
      try {
        const flushed = await store.flush();
        if (!flushed.ok) {
          const go = window.confirm(
            "아직 저장이 확정되지 않은 입력(또는 충돌)이 있습니다. 그래도 표시를 바꿀까요? (입력은 이 기기에 보관됩니다)",
          );
          if (!go) return;
        }
        const r = await setMyEcsShowSelfStudy(show);
        if (!r.ok) {
          toast.error(r.error ?? "표시 설정을 저장하지 못했습니다");
          return;
        }
        router.refresh();
      } finally {
        setSelfStudyPending(false);
      }
    },
    [data.showSelfStudy, router, selfStudyPending, store],
  );

  // ── 로스터 섹션 접기(내 계정) ──────────────────────────────────────────────
  // JJ 토글과 달리 **클라가 진실**이다 — 접기는 표시만 바꾸고 작성률·일괄 대상은 그대로라 서버를 다시
  // 부를 이유가 없다(글씨 크기와 같은 부류). 화면은 즉시, 계정 저장은 뒤따른다.
  const [collapsedGroups, setCollapsedGroups] = useState<RosterGroupKey[]>(
    data.collapsedRosterGroups,
  );
  // ⚠️ 다음 값을 **업데이터 밖에서** 계산한다. setState(prev => …) 콜백은 렌더 중에 실행되므로 그 안에서
  //    서버 액션을 부르면 렌더 도중 Router를 갱신하게 되고("Cannot update a component while rendering a
  //    different component" — 실측 2026-08-06), StrictMode에선 저장이 두 번 나간다. 부수효과는 항상 바깥.
  const toggleRosterGroup = useCallback(
    (key: RosterGroupKey) => {
      const next = collapsedGroups.includes(key)
        ? collapsedGroups.filter((k) => k !== key)
        : [...collapsedGroups, key];
      setCollapsedGroups(next);
      void setMyEcsCollapsedRosterGroups(next).then((r) => {
        if (!r.ok)
          toast.error(
            "접기 상태를 계정에 저장하지 못했습니다 — 이 화면에서는 적용됩니다",
          );
      });
    },
    [collapsedGroups],
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
      resolveConflict: (saveKey, choice) =>
        store.resolveConflict(saveKey, choice),
      addLine: (planDate, slotStart, termMode, skillArea) => {
        void createPlanLineAction({
          classId,
          planDate,
          slotStart,
          termMode,
          skillArea,
        }).then((r) => {
          if (!r.ok) return toast.error(r.error);
          setLinesBySlot((prev) => ({
            ...prev,
            [`${planDate}|${slotStart}`]: r.lines,
          }));
          for (const l of r.lines) {
            store.seed(l.id, "textbook", l.textbook);
            store.seed(l.id, "page_range", l.pageRange);
            store.seed(l.id, "progress", l.progress);
            store.seed(l.id, "homework", l.homework);
            store.seed(l.id, "skill_area", l.skillArea);
          }
        });
      },
      // 직전 교시 복사 — 서버가 canonical 행을 돌려주므로 addLine과 **같은 방식**으로 state를 갈아끼우고
      // CAS 시드도 다시 심는다(안 심으면 복사된 칸을 처음 고칠 때 expectedValue가 어긋나 충돌로 뜬다).
      copySlot: (planDate, slotStart, termMode) => {
        // ⚠️ **반영 전 flush 필수** — 복사는 대상 교시의 placeholder 행을 지우고 새로 넣는다(0183a). 아직
        //    확정 안 된 셀 입력(디바운스 800ms)이 큐에 남아 있으면 그 행이 먼저 삭제돼 patch가 `gone`으로
        //    떨어지고 방금 친 글자가 사라진다. '시트 가져오기'가 같은 이유로 `flushBeforeImport`를 둔다.
        void store.flush().then((flushed) => {
          if (!flushed.ok) {
            const go = window.confirm(
              "아직 저장이 확정되지 않은 입력(또는 충돌)이 있습니다. 그래도 직전 교시를 복사할까요? (입력을 잃을 수 있습니다)",
            );
            if (!go) return;
          }
          void copySlotFromPrevious({
            classId,
            planDate,
            slotStart,
            termMode,
          }).then((r) => {
            if (!r.ok) return toast.error(r.error);
            if (r.copied === 0) {
              // 서버가 "왜 아무것도 안 했는지"를 돌려준다 — 조용히 성공한 척하면 사람이 버튼을 계속 누른다.
              toast.info(
                r.reason === "target_not_empty"
                  ? "이미 계획이 있는 교시라 복사하지 않았습니다(덮어쓰기 없음)"
                  : "복사할 직전 교시가 없습니다(최근 8주 안에 작성된 같은 시기 계획이 없습니다)",
              );
              return;
            }
            setLinesBySlot((prev) => ({
              ...prev,
              [`${planDate}|${slotStart}`]: r.lines,
            }));
            for (const l of r.lines) {
              store.seed(l.id, "textbook", l.textbook);
              store.seed(l.id, "page_range", l.pageRange);
              store.seed(l.id, "progress", l.progress);
              store.seed(l.id, "homework", l.homework);
              store.seed(l.id, "skill_area", l.skillArea);
            }
            toast.success(
              r.sourceLabel
                ? `${r.sourceLabel} 교시에서 ${r.copied}줄 복사`
                : `${r.copied}줄 복사`,
            );
          });
        });
      },
      removeLine: (lineId, planDate, slotStart) => {
        void deletePlanLineAction({ classId, lineId }).then((r) => {
          if (!r.ok) return toast.error(r.error);
          setLinesBySlot((prev) => ({
            ...prev,
            [`${planDate}|${slotStart}`]: r.lines,
          }));
        });
      },
      moveLineTerm: (lineId, planDate, slotStart, termMode) => {
        void movePlanLineAction({ classId, lineId, termMode, lineNo: 99 }).then(
          (r) => {
            if (!r.ok) return toast.error(r.error);
            setLinesBySlot((prev) => ({
              ...prev,
              [`${planDate}|${slotStart}`]: r.lines,
            }));
          },
        );
      },
      // 출결(출석/지각/결석) — 출석부·원스크린과 **같은 액션**을 호출한다(게이트를 여기서 다시 짜지 않는다).
      // 낙관 반영 후 실패하면 직전 값으로 되돌린다 — 화면엔 남고 서버엔 없는 상태를 만들지 않기 위해
      // (툴바가 "저장됨"이라 말하는 동안 기록을 잃는 사고, 2026-07-29 적대검증).
      setAttendance: (studentId, date, status, note, units) => {
        if (!data.canMarkAttendanceByDate[date]) return;
        const key = `${studentId}|${date}`;
        const before = attendanceRef.current[key];
        // 🔴 **유닛 자동값은 넣지 않는다**(2026-08-06 적대 리뷰로 보류). 원장은 "3안(자동+수정)"을 골랐지만,
        //    구현 뒤 검증에서 **자동값의 단위가 틀렸다**는 게 드러났다: 0115a가 유닛을 *"EiE 40분 유닛,
        //    인재원 2시간 유닛"* 으로 정의하는데, 그 날 스케줄 행(40분)을 세면 인재원 영어에서 1이어야 할
        //    것이 3이 된다(3배 부풀림 → 급여·청구 직결). 단위 정의가 확정될 때까지 **사람이 적는다**.
        //    부수 효과로 0169a 취소 가드(`session_units=1`)도 그대로 살아 있다 — 자동값을 박으면 방금 잘못
        //    누른 출석을 ECS에서 못 지우고 "출석부에서 시수를 적어 둔 기록"이라는 거짓 사유가 떴다.
        // ⚠️ 낙관 표시값은 **서버와 같은 파서**로 만든다. `Number(units)`로 대충 바꾸면 쉼표 소수점("2,5" —
        //    parseSessionUnits가 허용한다)이 NaN→1로 보여, DB엔 2.5인데 화면엔 1인 채로 굳는다.
        const parsedUnits =
          units !== undefined ? parseSessionUnits(units) : null;
        const nextUnits =
          parsedUnits !== null
            ? parsedUnits.ok
              ? parsedUnits.value
              : (before?.units ?? null) // 형식 오류는 서버가 거절한다 → 화면은 안 건드린다
            : (before?.units ?? null);
        setAttendance((prev) => ({
          ...prev,
          // note를 안 넘긴 저장은 기존 사유를 그대로 둔다 — 서버 규약(undefined=유지)과 일치시킨다.
          [key]: {
            status,
            note: note === undefined ? (before?.note ?? null) : note,
            units: nextUnits,
          },
        }));
        void setAttendanceCell({
          classId,
          studentId,
          sessionDate: date,
          status,
          ...(note === undefined ? {} : { note }),
          // 유닛은 **사람이 고쳤을 때만** 보낸다 — 안 보내면 서버가 기존 값을 유지한다(자동 주입 없음).
          ...(units !== undefined ? { units } : {}),
        }).then((r) => {
          if ("error" in r) {
            setAttendance((prev) => {
              const next = { ...prev };
              if (before === undefined) delete next[key];
              else next[key] = before;
              return next;
            });
            toast.error(r.error);
          }
        });
      },
      // 출결 '선택 안 함'(지우기) — **0169a `ecs_clear_present` 한 경로만** 쓴다.
      // 🔴 한때 "사유 없는 present는 `setAttendanceCell({status:null})`로 지우자"로 우회했다가 되돌렸다
      //    (2026-08-06 적대 리뷰). 그 액션은 그 (학생,반,날짜)의 **모든 행을 무조건 지운다** — 같은 칸에
      //    정정 이력이 쌓여 있으면(예: 09시 '결석+병결' → 10시 '출석' 정정) 사유가 붙은 옛 행까지 함께
      //    날아간다. RPC는 정확히 그 경우를 `v_plain <> v_total`로 거절하고 있었다. 클라가 들고 있는 건
      //    **effective 한 행뿐**이라 이 판정을 클라에서 흉내낼 수 없다 — 서버 가드를 그대로 통과시킨다.
      clearAttendance: (studentId, date) => {
        if (!data.canMarkAttendanceByDate[date]) return;
        const key = `${studentId}|${date}`;
        const before = attendanceRef.current[key];
        if (before === undefined) return; // 이미 비어 있으면 왕복할 이유가 없다
        setAttendance((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        void clearPresentAttendance({ classId, studentId, date }).then((r) => {
          if (!r.ok) {
            setAttendance((prev) => ({ ...prev, [key]: before }));
            toast.error(r.error);
          }
        });
      },
      saveMark: (studentId, date, slotStart, status, note) => {
        const key = `${studentId}|${date}|${slotStart}`;
        // 실패 시 되돌릴 직전 값 — 낙관 반영만 하고 롤백이 없으면 화면엔 남고 서버엔 없는 상태가 되어
        // 툴바가 "저장됨"이라 말하는 동안 강사는 입력을 잃는다(적대검증 2026-07-29). 출석과 같은 처방.
        const before = marksRef.current[key] ?? null;
        setMarks((prev) => ({
          ...prev,
          [key]: { status, progressNote: note },
        }));
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
    (
      scope: "month" | "week",
      role: "homeroom" | "assistant",
      skillArea: string,
      field: "textbook" | "targetProgress",
      value: string,
    ) => {
      const periodStart = scope === "week" ? weekMonday : data.monthStart;
      setGoals((prev) => {
        const idx = prev.findIndex(
          (g) =>
            g.scope === scope &&
            g.role === role &&
            g.skillArea === skillArea &&
            g.periodStart === periodStart,
        );
        const base =
          idx >= 0
            ? prev[idx]
            : {
                scope,
                periodStart,
                role,
                skillArea,
                textbook: null,
                targetProgress: null,
              };
        const next = { ...base, [field]: value === "" ? null : value };
        const out = [...prev];
        if (idx >= 0) out[idx] = next;
        else out.push(next);
        return out;
      });
      store.scheduleLww(`goal:${scope}:${role}:${skillArea}`, async () => {
        // 최신 로컬 상태로 upsert(LWW) — 행 단위 저장이라 교재·목표를 함께 커밋(필드별 유실 방지)
        const g = goalsRef.current.find(
          (x) =>
            x.scope === scope &&
            x.role === role &&
            x.skillArea === skillArea &&
            x.periodStart === periodStart,
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
        if (!r.ok)
          toast.error(
            `${r.error} — 저장되지 않았습니다(새로고침하면 이전 값으로 돌아갑니다)`,
          );
      });
    },
    [classId, data.monthStart, store, weekMonday],
  );

  const saveWeekMemo = useCallback(
    (memoKey: string, body: string) => {
      setMemos((prev) => ({ ...prev, [memoKey]: body }));
      store.scheduleLww(`memo:${memoKey}`, async () => {
        const r = await saveMemo({
          classId,
          weekStart: weekMonday,
          memoKey,
          body,
        });
        if (!r.ok) toast.error(`${r.error} — 저장되지 않았습니다`);
      });
    },
    [classId, store, weekMonday],
  );

  const visibleDays = dayFilter
    ? data.grid.days.filter((d) => d.date === dayFilter)
    : data.grid.days;
  // "이 주는 아직 비어 있어요"는 **현재 화면 상태**로 판정한다. 서버 스냅샷(data.fill)만 보면 계획 셀
  // 저장이 RSC를 갱신하지 않으므로(서버 액션에 revalidate 없음·같은 주에선 재마운트 없음) 강사가 그 주를
  // 다 채워도 채워진 표 바로 위에 "비어 있어요"가 계속 뜬다(적대검증 2026-07-29, 첫 사용 시 100% 발생).
  const weekIsEmpty = useMemo(
    () =>
      data.fill.filledSlots === 0 &&
      !Object.values(linesBySlot).some((lines) =>
        lines.some((l) => isMeaningfulPlanLine(l)),
      ),
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
        showSelfStudy={data.showSelfStudy}
        onShowSelfStudy={(show) => void changeShowSelfStudy(show)}
        selfStudyPending={selfStudyPending}
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
            이전에 저장되지 못한 입력 {doc.recoverable.mutations.length}건이 이
            기기에 남아 있습니다.
          </span>
          <button
            type="button"
            className="text-primary cursor-pointer font-bold underline-offset-2 hover:underline"
            onClick={() => void applyRecovered()}
          >
            복구해서 저장
          </button>
          <button
            type="button"
            className="text-text-faint hover:text-foreground cursor-pointer"
            onClick={doc.dismissRecoverable}
          >
            무시
          </button>
        </div>
      ) : null}

      {canEdit && weekIsEmpty ? (
        <CopyPrevWeek
          classId={classId}
          weekMonday={weekMonday}
          weekLabelText={data.weekLabel}
        />
      ) : null}

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
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleRosterGroup}
          />
        </DragScrollArea>
      </div>

      {data.grid.attendanceOnly.length > 0 ? (
        <div className="bg-card shadow-card rounded-2xl px-4 py-3 text-[13px]">
          <p className="text-text-dim">
            수업 시간표가 없는 날짜의 출석 기록:{" "}
            {data.grid.attendanceOnly
              .map(
                (a) =>
                  `${a.date} (${a.studentIds.map((id) => data.students[id]?.name ?? "?").join(", ")})`,
              )
              .join(" · ")}
          </p>
        </div>
      ) : null}

      {/* 안 그린 자리에 쓴 기록이 남아 있으면 건수를 알린다 — 조용히 사라지면 "쓴 게 증발했다"가 된다.
          ⚠️ 자리마다 **문장이 다르다**: JJ는 상단 토글로 되돌릴 수 있지만 LAB은 화면에서 되돌릴 길이 없다
             (항상 제외). 한 문장으로 뭉치면 둘 중 하나는 반드시 거짓말이 된다. */}
      {data.grid.hiddenSpecial.map((h) => (
        <p key={h.seat} className="text-text-dim px-1 text-[12px]">
          {h.seat} 교시 {h.slots}개는 이 시트에 표시하지 않습니다 — 그 시간에
          남아 있는 기록 {h.records}건은 지워지지 않았습니다
          {h.seat === "JJ"
            ? "(상단 ‘JJ 표시’로 다시 볼 수 있습니다)."
            : "(LAB 전용 출석부가 열리면 그쪽에서 볼 수 있습니다)."}
        </p>
      ))}
    </div>
  );
}

/** 계획 셀 saveKey 헬퍼 — 하위 컴포넌트 공용. */
export function cellKey(
  lineId: string,
  field: (typeof PLAN_PATCH_FIELDS)[number],
): string {
  return buildSaveKey(lineId, field);
}
