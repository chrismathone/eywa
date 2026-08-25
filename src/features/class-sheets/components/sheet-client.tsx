"use client";

// ECS 주간 시트 오케스트레이터 — state 소유·저장 큐·저널·presence·네비 flush.
// 페이지가 key={classId:week}로 재마운트하므로 서버 데이터로 state가 재초기화된다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEditPresence } from "@/features/presence/edit-presence";
import type { ClassSheetWeekData } from "../server/queries";
// 출결 저장은 ECS 전용 액션을 만들지 않고 **출석부·원스크린과 같은 것**을 쓴다 — 권한·담당 반·7일 창
// 게이트를 화면마다 다시 짜면 한쪽만 느슨해진다(#77).
// ⚠️ queries.ts가 그 액션과 **같은 축**(`userTaughtClassSet` = 담임 ∪ 위임 ∪ 교시 담당)으로
//    `canMarkAttendanceByDate`를 미리 내려 컨트롤을 잠근다 — 서버가 거절할 사람에게만(거짓 어포던스 금지).
//    🔴 2026-08-19까지는 이 미리-잠금이 액션보다 **좁아서**(부담임 제외) 반대로 "서버는 허락하는데 화면이
//    막는" 거짓 잠금이었다. 두 축을 다시 갈라 놓지 말 것(write-gate-axis.test.ts).
import { setAttendanceCell } from "@/features/attendance/server/actions";
import { subscribeAttendanceApplied } from "@/features/attendance/live/attendance-applied-bus";
import { applyAppliedToSheetAtt } from "../lib/applied-attendance";
import { createInflightKeys } from "../lib/inflight-keys";
import { normalizeSlotTime } from "../lib/week";
import { parseSessionUnits } from "@/features/attendance/session-units";
import {
  clearPresentAttendance,
  flushSheetPatches,
  saveMemo,
  setMyEcsCollapsedRosterGroups,
  setMyEcsFontSize,
  setMyEcsShowSelfStudy,
  upsertGoal,
  upsertStudentMark,
  removeMakeupAttendee,
  type PlanLineDTO,
} from "../server/actions";
import { ECS_FONT_SIZE_ZOOM, type EcsFontSize } from "../font-size";
import type { CarryPatch } from "../lib/carry-marks";
import type { RosterGroupKey } from "../lib/roster-order";
import { ecsPresenceScope } from "../lib/presence-scope";
import type { MarkTextField } from "../lib/roster-form";
import { buildSaveKey, type PlanFieldPatch } from "../lib/save-keys";
import { PLAN_PATCH_FIELDS, isMeaningfulPlanLine } from "../lib/plan-codec";
// 오늘 면의 강사 축 필터(내 교시만) — 주간과 갈리는 유일한 지점이라 순수 모듈이 소유한다.
// ⚠️ 오늘 면의 **반 순서**(ecs/page.tsx)도 같은 모듈의 `firstVisibleTodaySlot`을 쓴다 — 화면이 그리는
//    교시와 줄 세우는 교시가 갈리면 순서가 다시 뒤집힌다(2026-08-19).
import { selectSheetDaysFor } from "../lib/today-own-slots";
// 계획 줄 기계(셀 CAS·줄 추가/삭제/시기 이동·내용 복사)는 **공용 훅 한 벌**이다 — 자리 출석부 JJ 열도
// 같은 훅을 쓴다(두 벌이 되면 같은 표를 다른 규칙으로 쓰게 된다). 저장 경로는 그 안이 끝.
import { ECS_PLAN_API } from "./plan-api";
import { seedPlanLines, usePlanHandlers, type PlanHandlers } from "./use-plan-handlers";
import { useSheetDoc } from "./use-sheet-doc";
import { useFlushOnUnmount, useSaveIndicator, useSheetSaveStore } from "./use-sheet-saves";
import { EditingBadge } from "@/features/presence/editing-badge";
import { SheetToolbar } from "./sheet-toolbar";
import { PlanPanel } from "./plan-panel";
import { SheetGrid } from "./sheet-grid";
import { CopyPrevWeek } from "./copy-prev-week";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { TodayClassSheet } from "./today-class-sheet";

/**
 * 시트 핸들러 = **계획 줄 기계**([PlanHandlers](./use-plan-handlers.ts)) + 출결·마크.
 * ⚠️ 계획 쪽 시그니처를 여기에 다시 적지 말 것 — 자리 출석부 JJ 열이 같은 타입을 쓴다(한 벌).
 */
export type SheetHandlers = PlanHandlers & {
  /**
   * 출결 저장(출석/지각/결석) — 원스크린·출석부와 **같은 서버 액션**(`setAttendanceCell`)을 쓴다.
   * 🔴 결석이 찍히면 시수·급여에 닿는다. 그래서 게이트를 ECS가 따로 만들지 않고 그 액션을 그대로 통과시킨다
   *    (권한·담당 반·강사 7일 창 — #77 "UI 조건은 게이트가 아니다").
   * ⚠️ `note`는 **넘길 때만** 갱신된다(undefined면 서버가 기존 사유를 유지) — 출석 pill이 사유를 지우지 않게.
   */
  setAttendance: (
    studentId: string,
    date: string,
    /** 이 칸의 **교시**(HH:MM) — 같은 날 교시가 둘이면 각각 따로 찍힌다(0196a). */
    slotStart: string,
    status: "present" | "late" | "absent",
    note?: string | null,
    /** 시수(유닛) raw 입력 — **넘길 때만** 갱신된다(안 넘기면 서버가 기존 값 유지, 자동 주입 없음). */
    units?: string,
  ) => void;
  /**
   * 출결 '선택 안 함'(체크 순환의 마지막 단계) — **사유·시수가 안 붙은 기본 3종만** 지워진다
   * (`ecs_clear_present`: 0169a는 present만이었고 **0203a가 지각·결석까지 넓혔다** — #103 탈출문).
   * 사람 손을 탄 기록(사유·시수)은 서버가 거절하고 사유를 띄운다 — 화면에서 지워진 것처럼 보였다가
   * 새로고침하면 돌아오는 거짓 성공을 만들지 않는다. ⚠️ 0203a 미적용 창에선 present만 지워진다(#95).
   */
  clearAttendance: (studentId: string, date: string, slotStart: string) => void;
  /** 보강 명단에서 빼기 — 수강생이 아닌 행만. 출결+태도 기록을 지운다. */
  removeMakeup: (studentId: string, date: string) => void;
  /**
   * **사유만** 고치는 저장(`setAttendanceCell({ noteOnly: true })`) — 상태·시수는 서버가 읽지도 쓰지도
   * 않는다. 🔴 이 경로만 **강사 7일 편집창을 면제**받는다(원장 2026-08-06 *"메모는 언제든 추가할 수
   * 있어야"* — 메모는 시수·급여에 안 닿는다). 담당 반·수강생 게이트는 그대로 서버가 본다.
   * ⚠️ 그날 기록이 **없으면** 서버가 거절한다(메모를 붙이려고 없는 출결을 지어내지 않는다).
   */
  setAttendanceNote: (
    studentId: string,
    date: string,
    slotStart: string,
    note: string | null,
  ) => void;
  saveMark: (
    studentId: string,
    date: string,
    slotStart: string,
    status: string | null,
    note: string | null,
    /**
     * 자유 입력 칸 패치(시험 점수 0202a · 듣기 레벨/누적 암기 단어수 0206a) — **바뀐 칸만** 담는다.
     * 🔴 안 담은 칸은 서버가 **지금 값 그대로** 둔다(upsert의 SET 목록에서 빠진다). 그래서 JJ 교시에서
     *    듣기 레벨을 고쳐도 그 행의 시험 점수가 지워지지 않고, 반대도 마찬가지다.
     */
    patch?: Partial<Record<MarkTextField, string | null>>,
  ) => void;
};

export function SheetClient({
  data,
  classOptions,
  userId,
  tenantId,
  initialDay = null,
  initialPanelOpen = true,
  variant = "full",
  myTeacherId = null,
}: {
  data: ClassSheetWeekData;
  classOptions: { id: string; name: string }[];
  userId: string;
  tenantId: string;
  /**
   * 요일 필터 초기값 — ECS '오늘' 면이 시트를 **그 날짜만** 보여줄 때 쓴다(2026-08-11).
   * URL `?day=`가 있으면 그쪽이 이긴다(단일 시트 화면의 기존 계약 불변). SSR·클라 초기값이 같아야
   * 하이드레이션이 안 어긋나므로 서버가 이 prop으로 확정해 내려준다.
   */
  initialDay?: string | null;
  /** 목표·메모 패널 초기 접힘 — 오늘 면은 시트가 N개 쌓여 패널까지 다 열면 화면이 무너진다. */
  initialPanelOpen?: boolean;
  /**
   * "today" = ECS 오늘 면 임베드(원장 2026-08-11 "중복 컴포넌트 다수" — 반마다 반복되던 툴바·주 복사
   * 배너·목표 패널을 걷어내고, 그 날짜의 교시 카드(가로)+**통합 로스터**만 그린다). 저널·CAS·presence
   * ·저장 경로는 full과 완전히 같다 — 이 스위치는 **껍데기(무엇을 그리나)**만 바꾼다.
   */
  variant?: "full" | "today";
  /**
   * 지금 보고 있는 사람의 **강사 id** — [`effectiveTeacherId()`](@/lib/auth/view-mode)의 값(겸직 강사뷰까지
   * 커버하는 단일 소스. `systemRole === "teacher"` 직접 비교 금지).
   *
   * 🔴 쓰이는 곳은 **`variant:"today"` 하나**다: 오늘 시트는 내 교시만 그린다(원장 2026-08-19 *"오늘
   *    시트에서는 본인 수업만 보이고, 주간 시트는 여전히 지금처럼"*). 주간 시트에는 넘겨도 아무 일이
   *    없다(반 전체를 보는 자리라 거르지 않는다 — 판정은 today-own-slots 한 곳).
   * ⚠️ null이면 아무것도 숨기지 않는다 — 스코프가 없는 사람(사무실)에게 "내 수업"이 없다.
   */
  myTeacherId?: string | null;
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
  useEditPresence(ecsPresenceScope(classId, weekMonday), canEdit);

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

  // CAS 셀 canonical 시드(텍스트 필드 + skill_area) — 시드 규약도 계획 훅과 **같은 함수**를 쓴다.
  useEffect(() => {
    for (const lines of Object.values(initialLines)) seedPlanLines(store, lines);
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
  /**
   * 그 날의 **첫 교시**(HH:MM) — 옛 "그날 전체"(slot null) 기록이 붙는 칸. 서버가
   * `attendanceByStudentDate` 키를 만들 때 쓰는 것과 **같은 규칙·같은 재료**(`data.grid.days`)여야
   * 방송으로 반영한 알약이 새로고침 뒤와 같은 칸에 남는다(queries.ts `firstSlotByDate`).
   */
  const firstSlotByDate = useMemo(() => {
    const out: Record<string, string> = {};
    for (const day of data.grid.days) {
      const first = day.slots[0]?.slotStart;
      if (first) out[day.date] = normalizeSlotTime(first);
    }
    return out;
  }, [data.grid.days]);
  // 출결은 계획 CAS 큐와 다른 공용 서버 액션을 쓰므로 별도 in-flight 집합으로 추적한다.
  // 바로 출석부로 이동하면 새 화면 조회가 저장보다 먼저 끝날 수 있어, 네비게이션은 이 집합도 drain한다.
  const attendanceSavesRef = useRef(new Set<Promise<void>>());
  /**
   * 저장 중인 출결 **칸 키**(`${studentId}|${date}|${cell}`) — 위 promise 집합과 목적이 다르다(저 쪽은
   * "다 끝났나", 이쪽은 "어느 칸이 내 것인가"). 상단 출석 스트립 방송이 방금 내가 누른 값을 되돌리지
   * 않게 하는 잠금이다(응답 역전 방지).
   * ⚠️ Set이 아니라 **카운터** — 같은 칸에 저장이 겹치면 먼저 끝난 쪽이 잠금을 풀어 버린다(inflight-keys.ts).
   *    잠금이 리셋되면 안 되므로 useState 지연 초기값(안정 보장)으로 만든다.
   */
  const [attendanceCellsInflight] = useState(createInflightKeys);
  const trackAttendanceCell = useCallback(
    (key: string, save: Promise<void>) => {
      attendanceCellsInflight.acquire(key);
      void save.finally(() => attendanceCellsInflight.release(key));
    },
    [attendanceCellsInflight],
  );
  /**
   * 상단 '오늘 출석 미입력' 스트립이 기록한 칸을 이 시트에 반영한다(원장 제보 2026-08-20 — 원스크린·오늘
   * 요약 카드와 **같은 원인**: 출결이 `useState(data.attendanceByStudentDate)`라 마운트 1회만 복사되고
   * 스트립의 `router.refresh()`는 클라 state를 보존한다).
   * ⚠️ **내 반만**(`classId`) — 스트립은 그 날 내 전 교시를 다루므로 다른 반의 칸이 섞여 온다.
   * ⚠️ 칸(교시)은 순수 함수가 서버와 **같은 규칙**으로 정한다(`slot` 있으면 그 교시, 없으면 첫 교시).
   * ⚠️ setState는 이벤트 콜백 안에서만(#25).
   */
  useEffect(
    () =>
      subscribeAttendanceApplied((detail) => {
        setAttendance((prev) =>
          applyAppliedToSheetAtt(
            prev,
            detail.cells,
            { date: detail.date, status: detail.status, slot: detail.slot, classId },
            firstSlotByDate,
            attendanceCellsInflight.snapshot(),
          ),
        );
      }),
    [classId, firstSlotByDate, attendanceCellsInflight],
  );
  const trackAttendanceSave = useCallback((save: Promise<void>) => {
    attendanceSavesRef.current.add(save);
    void save.finally(() => attendanceSavesRef.current.delete(save));
  }, []);
  const drainAttendanceSaves = useCallback(async () => {
    // 기다리는 중 새 저장이 추가될 수 있으므로 한 번의 snapshot이 아니라 빌 때까지 반복한다.
    while (attendanceSavesRef.current.size > 0) {
      await Promise.allSettled([...attendanceSavesRef.current]);
    }
  }, []);

  // ── 요일 필터(같은 주 전환 = flush·재조회 없이 History API) ────────────────
  const [dayFilter, setDayFilter] = useState<string | null>(() => {
    if (typeof window === "undefined") return initialDay;
    return new URLSearchParams(window.location.search).get("day") ?? initialDay;
  });
  const changeDayFilter = useCallback((day: string | null) => {
    setDayFilter(day);
    const url = new URL(window.location.href);
    if (day) url.searchParams.set("day", day);
    else url.searchParams.delete("day");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const [panelOpen, setPanelOpen] = useState(initialPanelOpen);

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
      await drainAttendanceSaves();
      router.push(href);
    },
    [drainAttendanceSaves, router, store],
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

  // ── 계획 줄(수업계획) — 공용 훅 한 벌 ─────────────────────────────────────
  // 🔴 여기서 액션을 다시 부르지 않는다: 셀 CAS·줄 추가/삭제/시기 이동·내용 복사는 전부
  //    [`usePlanHandlers`](./use-plan-handlers.ts)가 소유하고, 자리 출석부 JJ 열도 **같은 훅**을 쓴다.
  const applySlotLines = useCallback((planDate: string, slotStart: string, lines: PlanLineDTO[]) => {
    setLinesBySlot((prev) => ({ ...prev, [`${planDate}|${slotStart}`]: lines }));
  }, []);
  // JJ 이어받기 반영 — 🔴 서버가 돌려준 값으로 **화면 상태를 직접 머지**해야 한다: 마크는 클라
  // state(useState)라 refresh로는 안 바뀐다(강사는 "복사했는데 칸이 그대로"로 본다).
  const applyCarried = useCallback(
    (planDate: string, slotStart: string, carried: CarryPatch[]) => {
      setMarks((prev) => {
        const next = { ...prev };
        for (const p of carried) {
          const markKey = `${p.studentId}|${planDate}|${slotStart}`;
          const had = next[markKey];
          next[markKey] = {
            // 이어받기는 두 칸만 건드린다 — 태도·특이사항·시험 점수는 있던 값 그대로.
            status: had?.status ?? null,
            progressNote: had?.progressNote ?? null,
            score: had?.score ?? null,
            listeningLevel: p.listeningLevel,
            memorizedWords: p.memorizedWords,
          };
        }
        return next;
      });
    },
    [],
  );
  const planHandlers = usePlanHandlers({
    classId,
    // 로그인 시트는 언제나 ECS 게이트 — 공개 자리 PIN 문(seatPlanApi)은 그 화면만 쓴다.
    api: ECS_PLAN_API,
    store,
    onSlotLines: applySlotLines,
    onCarried: applyCarried,
  });

  // ── 핸들러(객체 ref 고정 — memoized row의 안정 콜백) ──────────────────────
  const handlers: SheetHandlers = useMemo(
    () => ({
      ...planHandlers,
      // 출결(출석/지각/결석) — 출석부·원스크린과 **같은 액션**을 호출한다(게이트를 여기서 다시 짜지 않는다).
      // 낙관 반영 후 실패하면 직전 값으로 되돌린다 — 화면엔 남고 서버엔 없는 상태를 만들지 않기 위해
      // (툴바가 "저장됨"이라 말하는 동안 기록을 잃는 사고, 2026-07-29 적대검증).
      setAttendance: (studentId, date, slotStart, status, note, units) => {
        if (!data.canMarkAttendanceByDate[date]) return;
        const key = `${studentId}|${date}|${slotStart}`;
        const before = attendanceRef.current[key];
        // DB에 보낼 교시 — 이미 기록이 있으면 **그 행이 들고 있는 값**(옛 기록은 null)을 그대로 써서
        // 제자리에서 고친다. 없으면 이 칸의 교시로 새로 만든다.
        // ⚠️ 옛 null 행에 칸의 교시를 보내면 새 행이 하나 더 생겨 같은 날 시수가 두 번 잡힌다.
        const dbSlot = before ? before.slot : slotStart;
        // 🔴 유닛 자동값은 **쓰지 않는다**(원장 2026-08-10: *"eie든 인재원 수업이든 다 1 / 분에 상관없이
        //    다 1로 처리할것"*). 2026-08-06의 트랙별 자동값(EiE=교시 수, 인재원=총 분÷60)은 폐기 —
        //    60분+50분짜리 날이 1.8로 찍혀 "하나당 1"이라는 셈과 어긋났다. 이제 새 기록은 전부 기본 1(=null).
        // ⚠️ `unitsByDate`는 **취소 경로에만** 남는다(아래 clearAttendance) — 옛 자동값(1.8·4 등)이 박힌
        //    기록을 계속 되돌릴 수 있어야 하기 때문(0187a 계약). 여기서 되살려 쓰지 말 것.
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
            slot: dbSlot,
          },
        }));
        const save = setAttendanceCell({
          classId,
          studentId,
          sessionDate: date,
          slotStart: dbSlot,
          status,
          ...(note === undefined ? {} : { note }),
          // 유닛은 **사람이 고쳤을 때만** 보낸다(그 외엔 서버가 기존 값 유지 — 새 기록은 기본 1).
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
        trackAttendanceSave(save);
        trackAttendanceCell(key, save); // 이 칸은 내 쓰기가 진실 — 스트립 방송이 덮지 못하게
      },
      // 출결 '선택 안 함'(지우기) — **0169a `ecs_clear_present` 한 경로만** 쓴다.
      // 🔴 한때 "사유 없는 present는 `setAttendanceCell({status:null})`로 지우자"로 우회했다가 되돌렸다
      //    (2026-08-06 적대 리뷰). 그 액션은 그 (학생,반,날짜)의 **모든 행을 무조건 지운다** — 같은 칸에
      //    정정 이력이 쌓여 있으면(예: 09시 '결석+병결' → 10시 '출석' 정정) 사유가 붙은 옛 행까지 함께
      //    날아간다. RPC는 정확히 그 경우를 `v_plain <> v_total`로 거절하고 있었다. 클라가 들고 있는 건
      //    **effective 한 행뿐**이라 이 판정을 클라에서 흉내낼 수 없다 — 서버 가드를 그대로 통과시킨다.
      clearAttendance: (studentId, date, slotStart) => {
        if (!data.canMarkAttendanceByDate[date]) return;
        const key = `${studentId}|${date}|${slotStart}`;
        const before = attendanceRef.current[key];
        if (before === undefined) return; // 이미 비어 있으면 왕복할 이유가 없다
        setAttendance((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        const save = clearPresentAttendance({
          classId,
          studentId,
          date,
          // 자동값과 같은 시수는 'ECS가 넣은 그대로'라 되돌릴 수 있다(0187a) — 사람이 고쳤으면 서버가 거절.
          autoUnits: data.unitsByDate[date] ?? null,
          // 그 칸이 실제로 보고 있던 행의 교시(옛 기록이면 null) — 0197a가 그 행만 지운다.
          slot: before.slot,
        }).then((r) => {
          if (!r.ok) {
            setAttendance((prev) => ({ ...prev, [key]: before }));
            toast.error(r.error);
          }
        });
        trackAttendanceSave(save);
        trackAttendanceCell(key, save); // 지우는 중에 도착한 방송이 방금 지운 칸을 되살리지 않게
      },
      removeMakeup: (studentId, date) => {
        if (!data.canMarkAttendanceByDate[date]) return;
        const prefix = `${studentId}|${date}|`;
        const before = Object.fromEntries(
          Object.entries(attendanceRef.current).filter(([k]) => k.startsWith(prefix)),
        );
        setAttendance((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(before)) delete next[k];
          return next;
        });
        setMarks((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(prev)) if (k.startsWith(prefix)) delete next[k];
          return next;
        });
        const save = removeMakeupAttendee({ classId, studentId, date }).then((r) => {
          if (!r.ok) {
            setAttendance((prev) => ({ ...prev, ...before }));
            toast.error(r.error);
            return;
          }
          toast.success("보강 명단에서 뺐습니다");
          router.refresh();
        });
        trackAttendanceSave(save);
        // 그 학생·그 날의 **모든 칸**이 대상이라 키마다 잠근다(한 칸만 잠그면 나머지가 되살아난다).
        for (const k of Object.keys(before)) trackAttendanceCell(k, save);
      },
      // 사유만 — 상태·시수는 안 보낸다(noteOnly). 잠긴 날짜(7일 초과)의 유일한 쓰기 경로라
      // `canMarkAttendanceByDate`를 보지 않는다 — 대신 서버가 권한·담당 반을 그대로 검사한다(#77).
      setAttendanceNote: (studentId, date, slotStart, note) => {
        const key = `${studentId}|${date}|${slotStart}`;
        const before = attendanceRef.current[key];
        if (before === undefined) return; // 기록이 없으면 붙일 자리가 없다(서버도 거절한다)
        setAttendance((prev) => ({ ...prev, [key]: { ...before, note } }));
        const save = setAttendanceCell({
          classId,
          studentId,
          sessionDate: date,
          // 그 행이 실제로 들고 있는 교시(옛 기록이면 null) — 제자리에서 고친다.
          slotStart: before.slot,
          // 🔴 null이지만 **지우지 않는다** — `noteOnly` 분기가 삭제 분기보다 먼저 오고, 그 안에서는
          //    status를 읽지도 쓰지도 않는다. "상태는 손대지 않는다"를 그대로 적은 값이다.
          status: null,
          note,
          noteOnly: true,
        }).then((r) => {
          if ("error" in r) {
            setAttendance((prev) => ({ ...prev, [key]: before }));
            toast.error(r.error);
          }
        });
        trackAttendanceSave(save);
        // 사유만 고치는 저장도 롤백이 **값 객체 통째**라 방송이 끼면 상태가 되돌아간다 — 같이 잠근다.
        trackAttendanceCell(key, save);
      },
      saveMark: (studentId, date, slotStart, status, note, patch) => {
        const key = `${studentId}|${date}|${slotStart}`;
        // 실패 시 되돌릴 직전 값 — 낙관 반영만 하고 롤백이 없으면 화면엔 남고 서버엔 없는 상태가 되어
        // 툴바가 "저장됨"이라 말하는 동안 강사는 입력을 잃는다(적대검증 2026-07-29). 출석과 같은 처방.
        const before = marksRef.current[key] ?? null;
        // 화면 상태는 **머지**(안 건드린 칸은 지금 값 유지) — 서버도 같은 규약이라 둘이 어긋나지 않는다.
        setMarks((prev) => ({
          ...prev,
          [key]: {
            status,
            progressNote: note,
            score: before?.score ?? null,
            listeningLevel: before?.listeningLevel ?? null,
            memorizedWords: before?.memorizedWords ?? null,
            ...patch,
          },
        }));
        store.scheduleLww(`mark:${key}`, async () => {
          const r = await upsertStudentMark({
            classId,
            studentId,
            markDate: date,
            slotStart,
            status,
            progressNote: note,
            // 🔴 **바뀐 칸만** 보낸다 — 안 보낸 칸은 서버가 건드리지 않는다(다른 폼의 값을 지우지 않게).
            ...patch,
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
    // unitsByDate가 빠지면 주를 넘긴 뒤에도 **옛 주의 유닛**이 박힌다(시수=급여라 조용한 오기록).
    [
      classId,
      data.canMarkAttendanceByDate,
      data.unitsByDate,
      planHandlers,
      router,
      store,
      trackAttendanceSave,
      trackAttendanceCell,
    ],
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

  // 요일 필터 + **오늘 면의 강사 축 필터**를 한 곳에서(today-own-slots) — 주간(full)은 종전 그대로다.
  // 🔴 오늘 면의 소비처(폭 계산·보강 추가·DayBulk·계획 층·로스터 층)가 **같은 배열**을 봐야 위아래
  //    격자가 맞으므로(today-columns 계약) 거르는 자리는 여기 하나뿐이다 — 층마다 따로 거르지 말 것.
  // ⚠️ 기록 판정은 **서버 스냅샷**(data.*)으로 한다. 로컬 state(marks·attendance)로 재면 숨긴 교시가
  //    타이핑 중에 나타났다 사라지고(칸이 없으니 애초에 못 쓴다), memo된 표가 매 입력마다 다시 그려진다.
  const selection = useMemo(
    // 위임받아 대신 맡은 반은 거르지 않는다(delegated) — 교시 담당이 자리를 비운 강사라 전부 숨겨져
    // "위임받았는데 화면이 비어 있다"가 된다(0173a가 막으려던 조용한 실패). 규칙은 순수 모듈 소유.
    () => selectSheetDaysFor(data, { variant, dayFilter, myTeacherId }),
    [variant, data, dayFilter, myTeacherId],
  );
  const visibleDays = selection.days;
  // today 변형이 그릴 하루 — initialDay가 확정돼 내려오므로 사실상 항상 있다(없으면 "수업 없음").
  const todayDay = selection.todayDay;
  // 남의 교시를 숨겼는가 — **빈 하루의 사유를 가르는 데만** 쓴다(각주 문장은 원장 지시로 폐기, 2026-08-19).
  const hasHiddenOwn = selection.hiddenOwn.length > 0;
  // 저장 표시기 — full은 SheetToolbar가 자체 구독으로 그린다. today는 툴바가 없어 **여기서** 충돌·저장 중을
  // 그려야 한다(적대 리뷰 2026-08-11: 복구 배너로 살아난 패치가 다른 날짜 셀에서 충돌하면 today엔 그 충돌을
  // 보여줄 표면이 없었다 — 충돌은 조용히 사라지면 입력 유실이다).
  const saveIndicator = useSaveIndicator(store);
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
    // today 임베드는 h-full을 안 쓴다 — 자연 높이로 쌓여 페이지가 스크롤한다(부모에 높이가 없다).
    <div className={variant === "today" ? "flex flex-col gap-3" : "flex h-full min-h-0 flex-col gap-3"}>
      {variant === "full" ? (
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
        />
      ) : null}

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

      {variant === "full" && canEdit && weekIsEmpty ? (
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
        className={variant === "today" ? "min-w-0" : "flex min-h-0 flex-1 items-stretch gap-3"}
        style={fontZoom === 1 ? undefined : { zoom: fontZoom }}
      >
        {variant === "today" ? (
          // 🔴 상태 표면(충돌·저장 중)은 **하루가 비어 있어도** 그린다 — 복구 배너로 살아난 패치가
          //    지금 안 보이는 칸(숨긴 교시·수업 없는 날)에서 충돌하면 보여 줄 자리가 사라진다
          //    (충돌이 조용히 사라지면 입력 유실 — 2026-08-11 적대 리뷰가 잡았던 바로 그 구멍).
          <div className="min-w-0 space-y-2">
            {/* 툴바가 없는 변형의 상태 표면 — 충돌·저장 중일 때만. 조용할 땐 아무것도 안 그린다
                (반마다 '저장됨'이 줄지어 서면 소음이다). 충돌한 셀이 다른 날짜(복구 패치)면 이
                화면엔 안 보이므로 주간 시트로 안내한다.
                ⚠️ '수정중' 배지는 **카드 안 머리**로 내려갔다(2026-08-18 제목 이동) — 여기 남기면
                   제목 줄을 없앤 만큼을 이 줄이 도로 먹는다. */}
            {(saveIndicator.conflicts > 0 || saveIndicator.pending > 0) ? (
              <div className="flex flex-wrap items-center gap-2 px-1">
                {saveIndicator.conflicts > 0 ? (
                  <span className="text-danger text-[12px] font-bold whitespace-nowrap">
                    저장 충돌 {saveIndicator.conflicts}건 — 충돌한 셀에서 서버값/내 값을 고르세요(이 화면에 안
                    보이면 주간 시트에서)
                  </span>
                ) : (
                  <span className="text-text-dim text-[12px] font-semibold whitespace-nowrap">저장 중…</span>
                )}
              </div>
            ) : null}
            {todayDay && todayDay.slots.length > 0 ? (
              <>
                <TodayClassSheet
                  day={todayDay}
                  header={
                    /* 반 이름 = 이 격자가 **어느 반인지** 말하는 유일한 자리라 또렷해야 한다(원장
                       2026-08-11 "수업명을 더 선명하게"). 카드 바깥 제목 줄이 사라졌으므로 그 위계를
                       여기로 그대로 옮긴다 — 이름 굵게, 링크는 한 단계 낮춰 이름이 먼저 읽히게.
                       ⚠️ 이름이 길면 잘라 낸다(`min-w-0` + 말줄임) — 안 그러면 카드가 늘어나
                       아래 표와 어긋난다. 전체 이름은 title 툴팁에 남는다. */
                    <div className="flex min-w-0 items-baseline gap-x-2">
                      <h2
                        className="text-foreground min-w-0 truncate text-[17px] leading-tight font-extrabold tracking-tight"
                        title={data.className}
                      >
                        {data.className}
                      </h2>
                      <Link
                        href={`/ecs/${classId}?week=${weekMonday}`}
                        className="text-primary shrink-0 text-[12.5px] font-medium underline-offset-2 hover:underline"
                      >
                        주간 시트 열기 →
                      </Link>
                      <EditingBadge scope={ecsPresenceScope(classId, weekMonday)} />
                    </div>
                  }
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
                {/* ⚠️ 숨긴 남의 교시 각주는 **폐기**(원장 2026-08-19 "이 멘트 필요없음") — 되돌릴 곳
                    안내는 오늘 면 맨 위 한 줄이 대신한다(ecs/page.tsx). 여기 각주를 되살리지 말 것. */}
              </>
            ) : (
              <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
                {/* ⚠️ 원인을 뭉치지 않는다 — 반의 그 날 교시가 **전부 남의 것**이어서 빈 것과, 애초에
                    수업이 없는 것은 사람이 할 일이 다르다. "수업이 없습니다"로 뭉치면 거짓말이 된다. */}
                {hasHiddenOwn
                  ? "이 날 이 반에 담당하시는 교시가 없습니다. 기록은 그대로 있고 주간 시트에서 보입니다."
                  : "이 날은 수업이 없습니다."}
              </p>
            )}
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* 주 전체 집계 각주(시간표 밖 출석 기록) — **full 전용**. 하루짜리 오늘 변형 밑에 주 전체
          숫자를 깔면 그 날 화면과 숫자가 안 맞는 거짓 표시가 된다(적대 리뷰 2026-08-11). 오늘 면에는
          반마다 '주간 시트 열기' 링크가 있어 그쪽에서 그대로 보인다. */}
      {variant === "full" && data.grid.attendanceOnly.length > 0 ? (
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
             (항상 제외). 한 문장으로 뭉치면 둘 중 하나는 반드시 거짓말이 된다.
          ⚠️ 오늘 변형엔 그 토글(SheetToolbar)이 없다 — 없는 컨트롤을 가리키면 거짓 안내이므로 문구를
             '주간 시트의 토글'로 바꾼다(건수는 주 전체 기준임을 함께 밝힌다). */}
      {data.grid.hiddenSpecial.map((h) => (
        <p key={h.seat} className="text-text-dim px-1 text-[12px]">
          {h.seat} 교시 {h.slots}개는 이 시트에 표시하지 않습니다(이번 주 기준) — 그 시간에
          남아 있는 기록 {h.records}건은 지워지지 않았습니다
          {h.seat === "JJ"
            ? variant === "today"
              ? "(주간 시트의 ‘JJ 표시’로 다시 볼 수 있습니다)."
              : "(상단 ‘JJ 표시’로 다시 볼 수 있습니다)."
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
