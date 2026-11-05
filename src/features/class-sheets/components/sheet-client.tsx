"use client";

// ECS 주간 시트 오케스트레이터 — state 소유·저장 큐·저널·presence·네비 flush.
// 페이지가 key={classId:week}로 재마운트하므로 서버 데이터로 state가 재초기화된다.
import { useSheetTf, useSheetFeedback } from "@/features/teacher-view/lang-context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmbedLink } from "@/components/embed-link";
// 강사뷰 화면 언어(2026-09-03) — 반 이름은 번역 대상이 아니고 안내·링크 글자만 사전을 탄다.
import { useSheetLang, useSheetT } from "@/features/teacher-view/lang-context";
import { classNameFor } from "@/features/teacher-view/class-name";
import { useRouter } from "next/navigation";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
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
  setSlotShouting,
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
import type { EcsMemorizedWritten } from "../server/memorized-actions";
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
// 칸 편집 감사로그(원장 결정 2026-09-14 "칸 입력을 마칠 때 한 줄") — 규약은 lib/edit-audit.ts 한 벌.
import { useSheetEditAudit } from "./use-sheet-edit-audit";
import { markEditTouches } from "../lib/edit-audit";
import { EditingBadge } from "@/features/presence/editing-badge";
import { SheetToolbar } from "./sheet-toolbar";
import { PlanPanel } from "./plan-panel";
import { SheetGrid } from "./sheet-grid";
import { CopyPrevWeek } from "./copy-prev-week";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { TodayClassSheet } from "./today-class-sheet";
import { writeLockedNote } from "@/lib/write-lock";

/** 쓰기 권한은 있지만 담당 반이 아니라서 보기만 할 때의 안내(권한 안내 writeLockedNote와 구분). */
const ECS_SCOPE_LOCK_NOTE = "담당 반이 아니라 보기만 할 수 있습니다.";

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
  /**
   * 교시 체크 'Shouting'(0230a) — **EiE 반만** 화면에 그린다(원장 2026-08-27).
   * 낙관 반영 후 실패하면 되돌리고 이유를 띄운다(체크가 화면엔 남고 서버엔 없는 상태 금지).
   */
  toggleShouting: (date: string, slotStart: string, next: boolean) => void;
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
  /**
   * [SRS 단어수] 가져오기가 **실제로 적은 값**을 화면 state에 옮긴다(0206a 칸).
   * 🔴 `router.refresh()`로는 안 바뀐다 — 마크는 `useState(data.marks)`라 마운트 1회만 복사된다
   *    (`applyCarried` 각주와 같은 함정: 안 옮기면 "눌렀는데 칸이 그대로"로 보인다).
   * ⚠️ **없으면 버튼 자체를 안 그린다**(`onShouting`과 같은 규약) — 값을 옮길 손이 없는 화면에
   *    버튼을 세우면 거짓 성공이 된다. 서버가 이미 썼으므로 저장 큐는 타지 않는다(낙관 반영 아님).
   */
  applyMemorizedWords?: (
    date: string,
    slotStart: string,
    written: readonly EcsMemorizedWritten[],
  ) => void;
};

/**
 * '오늘' 면 반 카드의 **머리 줄** — 반 이름 + '주간 시트 열기'.
 *
 * 🔑 정상 카드와 **빈 카드가 같은 조각**을 쓴다(원장 2026-09-03 제보: 빈 카드가 반 이름 없이 회색
 *    문장만 떠서 **똑같은 상자 두 개**로 보였다 — 그런 반이 둘이면 어느 반인지 알 수 없었다).
 *    두 벌로 적으면 한쪽만 바뀌므로 조각 하나로 둔다.
 * 🔴 **반 이름은 영어 화면에서 영문 표기로 바뀐다**(원장 2026-09-03 — 낱말 표 하나로 옮기는
 *    [`classNameFor`](@/features/teacher-view/class-name) 단일 소스. 옛 규약 "반 이름은 번역하지
 *    않는다"는 그 지시로 뒤집혔다). 구조는 그대로라 한국어 이름과 눈으로 1:1 대조된다.
 * ⚠️ 이름이 길면 잘라 낸다(`min-w-0` + 말줄임) — 안 그러면 카드가 늘어나 아래 표와 어긋난다.
 *    전체 이름은 title 툴팁에 남는다.
 */
function TodayCardHead({
  className,
  href,
  children,
}: {
  className: string;
  /** '주간 시트 열기' 링크 주소. **null이면 링크를 안 단다** — 주간 시트에 볼 게 없는 갈래(그 날
   *  수업 자체가 없음)에서 링크를 걸면 **없는 것을 보러 가라고 보내는 셈**이다. */
  href: string | null;
  /** 오른쪽에 덧붙일 것(정상 카드의 '수정중' 배지). 빈 카드엔 없다(편집 중일 수가 없다). */
  children?: React.ReactNode;
}) {
  const t = useSheetT();
  // 🔴 반 이름 표기도 언어를 따른다(원장 2026-09-03) — 판정은 `classNameFor` 한 곳.
  const shown = classNameFor(className, useSheetLang());
  return (
    // 🔴 **`flex-wrap` 필수**(원장 제보 2026-09-03 "수정중 배지 글자가 겹침"). 실측(크롬, 오늘 면):
    //    이 줄은 옆 일괄 버튼들에 밀려 **131.8px**까지 좁아지는데, 안에 든 것은 이름 + 링크(123px) +
    //    '수정중' 배지(89px)다. 링크는 `shrink-0`이고 배지는 `whitespace-nowrap`+기본 `min-width:auto`라
    //    **줄일 수 없어서**, 줄어들 수 있는 것은 이름뿐이라 **이름이 0px로 사라지고 배지가 96.7px 밖으로
    //    삐져나와 옆 내용 위에 겹쳐 그려졌다**. (그래서 배지에 `shrink-0`을 더하는 건 고침이 아니다 —
    //    애초에 안 줄어들고 있었다.)
    //    `flex-wrap`이면 넘칠 때 배지가 다음 줄로 내려간다: 실측 삐져나옴 +96.7px → **−42.5px**(안쪽),
    //    반 이름 0px → **27.9px**(다시 보임). 넓은 카드(533px)는 한 줄 그대로라 변화 없다.
    // ⚠️ 밀도 높은 **입력 표**에서는 여전히 `flex-wrap` 금지(행이 두 줄이 되면 줄맞춤이 깨진다) —
    //    여기는 카드 머리 줄이라 한 줄 더 내려가도 격자가 안 흔들린다.
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      {/* 반 이름 = 이 격자가 **어느 반인지** 말하는 유일한 자리라 또렷해야 한다(원장 2026-08-11
          "수업명을 더 선명하게"). 이름 굵게, 링크는 한 단계 낮춰 이름이 먼저 읽히게. */}
      <h2
        className="text-foreground min-w-0 truncate text-lg leading-tight font-extrabold tracking-tight"
        title={shown}
      >
        {shown}
      </h2>
      {href ? (
        // 창 안이면 embed=1을 싣는다(EmbedLink) — 오늘 면에서 주간 시트로 가는 자주 쓰는 링크.
        <EmbedLink
          href={href}
          className="text-primary shrink-0 text-xs font-medium underline-offset-2 hover:underline"
        >
          {t("today.card.openWeek")}
        </EmbedLink>
      ) : null}
      {children}
    </div>
  );
}

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
  const feedback = useSheetFeedback();
  const tf = useSheetTf();
  const router = useRouter();
  // 빈 카드 안내 문구(오늘 면) — 반 이름은 번역 대상이 아니다.
  const t = useSheetT();
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
  // 칸 편집 감사로그 — 목표·학생 기록·메모 칸을 떠날 때 한 줄. 기록 전에 **이 저장 큐를 비운다**(store.flush는
  // 진행 중 LWW까지 기다린다) — 안 비우면 서버가 도착 전 DB를 읽어 바뀐 칸을 "안 바뀜"으로 흘린다.
  const audit = useSheetEditAudit({ enabled: canEdit, flush: () => store.flush() });
  useEffect(() => {
    store.setCallbacks({
      onError: (m) => toast.error(feedback(m)),
      onGone: () => toast.info(t("plan.editor.gone")),
      // 계획 칸(교재·진도·과제…) 입력마다 편집 전 값 — 감사로그가 칸마다 첫 값만 잡는다(원장 결정 2026-09-14 범위 확대).
      onEdit: (lineId, field, before) => audit.touch(classId, { kind: "plan", lineId, field }, before),
    });
  }, [audit, classId, feedback, store, t]);

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
  // Shouting 체크(0230a) — 서버 스냅샷으로 시작하고, 토글은 낙관 반영 + 실패 시 되돌린다.
  const [shouting, setShouting] = useState(data.shoutingSlots);
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
  // 메모의 편집 전 값(감사로그) — 핸들러가 useCallback으로 고정돼 클로저의 memos는 낡는다.
  const memosRef = useRef(memos);
  useEffect(() => {
    memosRef.current = memos;
  }, [memos]);
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
          feedback(t("os.c.fontSizeFail")),
        );
    });
  }, [feedback, t]);
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
            t("plan.feedback.displayUnsaved"),
          );
          if (!go) return;
        }
        const r = await setMyEcsShowSelfStudy(show);
        if (!r.ok) {
          toast.error(feedback(r.error ?? t("os.display.saveFail")));
          return;
        }
        router.refresh();
      } finally {
        setSelfStudyPending(false);
      }
    },
    [data.showSelfStudy, feedback, router, selfStudyPending, store, t],
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
            feedback(t("plan.feedback.collapse")),
          );
      });
    },
    [collapsedGroups, feedback, t],
  );

  // ── 네비(주/반 이동) — flush 성공 후에만 이동, 실패·미확정 시 중단(저널 보존) ─
  // ⚠️ 창 안이면 이동 주소에 embed=1을 싣는다(반 선택·주 이동·면 전환이 전부 여기를 지난다) — 빼면 창 주소 되붙이기
  //    (EmbedUrlKeeper)에 기대게 되고, 그 뒤 첫 새로고침이 라우터 트리와 어긋나 한 번 더 받는다(전수검사 리뷰 2026-09-11).
  const embed = useEmbed();
  const navigate = useCallback(
    async (raw: string) => {
      // 이동 주소는 여기서 한 번 정한다 — 아래 `router.push(href)` 모양은 출결 배선 가드가 잠근 순서다(저장 비운 뒤 이동).
      const href = embed ? withEmbed(raw) : raw;
      const r = await store.flush();
      if (!r.ok) {
        const go = window.confirm(
          t("plan.feedback.navigateUnsaved"),
        );
        if (!go) return;
      }
      await drainAttendanceSaves();
      router.push(href);
    },
    [drainAttendanceSaves, embed, router, store, t],
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
    toast.info(tf("plan.feedback.recovered", { n: muts.length }));
  }, [doc, store, tf]);

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
  /**
   * SRS 단어수 반영 — 서버가 **이미 저장한** 값을 화면에 옮기는 것뿐이다(낙관 반영이 아니라 사후 반영이라
   * 롤백이 없다). 🔴 `memorizedWords`만 바꾼다 — 태도·특이사항·시험 점수·듣기 레벨은 있던 값 그대로.
   */
  const applyMemorizedWords = useCallback(
    (date: string, slotStart: string, written: readonly EcsMemorizedWritten[]) => {
      if (!written.length) return;
      setMarks((prev) => {
        const next = { ...prev };
        for (const w of written) {
          const markKey = `${w.studentId}|${date}|${slotStart}`;
          const had = next[markKey];
          next[markKey] = {
            status: had?.status ?? null,
            progressNote: had?.progressNote ?? null,
            score: had?.score ?? null,
            listeningLevel: had?.listeningLevel ?? null,
            memorizedWords: w.memorizedWords,
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
    // 한 주 전체를 그리는 화면 — 미룸·당김이 바꾼 그 주의 다른 칸(화를 누르면 금요일)도 함께 갈아 끼운다.
    multiSlot: true,
  });

  // ── 핸들러(객체 ref 고정 — memoized row의 안정 콜백) ──────────────────────
  const handlers: SheetHandlers = useMemo(
    () => ({
      ...planHandlers,
      applyMemorizedWords,
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
        // 새 교시의 자동 시수는 공용 서버 액션이 배치·반 기준으로 정하고 응답으로 돌려준다(2026-09-22).
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
        const optimistic = { status, note: note === undefined ? (before?.note ?? null) : note, units: nextUnits, slot: dbSlot };
        setAttendance((prev) => ({
          ...prev,
          // note를 안 넘긴 저장은 기존 사유를 그대로 둔다 — 서버 규약(undefined=유지)과 일치시킨다.
          [key]: optimistic,
        }));
        const save = setAttendanceCell({
          classId,
          studentId,
          sessionDate: date,
          slotStart: dbSlot,
          status,
          ...(note === undefined ? {} : { note }),
          // 유닛은 사람이 고쳤을 때만 보낸다. 서버는 기존 값을 보존하고 새 기록만 자동 환산한다.
          ...(units !== undefined ? { units } : {}),
        }).then((r) => {
          if ("error" in r) {
            setAttendance((prev) => {
              const next = { ...prev };
              if (before === undefined) delete next[key];
              else next[key] = before;
              return next;
            });
            toast.error(feedback(r.error));
          } else if ("autoUnits" in r) {
            // 응답을 기다리는 동안 다시 입력한 칸은 덮지 않는다.
            setAttendance((prev) => prev[key] === optimistic ? { ...prev, [key]: { ...optimistic, units: r.autoUnits ?? null } } : prev);
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
            toast.error(feedback(r.error));
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
            toast.error(feedback(r.error));
            return;
          }
          toast.success(t("today.makeup.removed"));
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
            toast.error(feedback(r.error));
          }
        });
        trackAttendanceSave(save);
        // 사유만 고치는 저장도 롤백이 **값 객체 통째**라 방송이 끼면 상태가 되돌아간다 — 같이 잠근다.
        trackAttendanceCell(key, save);
      },
      toggleShouting: (date, slotStart, next) => {
        const key = `${date}|${normalizeSlotTime(slotStart)}`;
        setShouting((prev) => ({ ...prev, [key]: next }));
        store.scheduleLww(`shout:${key}`, async () => {
          const r = await setSlotShouting({ classId, date, slotStart, value: next });
          if (!r.ok) {
            // 되돌린다 — "체크했는데 서버엔 없음"은 다음 사람이 못 알아챈다(마크·출결과 같은 처방).
            setShouting((prev) => ({ ...prev, [key]: !next }));
            toast.error(feedback(r.error));
          }
        });
      },
      saveMark: (studentId, date, slotStart, status, note, patch) => {
        const key = `${studentId}|${date}|${slotStart}`;
        // 실패 시 되돌릴 직전 값 — 낙관 반영만 하고 롤백이 없으면 화면엔 남고 서버엔 없는 상태가 되어
        // 툴바가 "저장됨"이라 말하는 동안 강사는 입력을 잃는다(적대검증 2026-07-29). 출석과 같은 처방.
        const before = marksRef.current[key] ?? null;
        // 감사로그 — 이 저장이 **바꾸는** 칸만, 편집을 시작한 순간의 값으로(칸을 떠날 때 한 줄).
        // 태도 순환처럼 여러 번 눌러도 칸마다 첫 값 하나만 잡힌다.
        for (const edit of markEditTouches(before, { status, progressNote: note, ...patch })) {
          audit.touch(classId, { kind: "mark", studentId, date, slotStart, field: edit.field }, edit.before);
        }
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
            toast.error(feedback(r.error));
          }
        });
      },
    }),
    // unitsByDate가 빠지면 주를 넘긴 뒤에도 **옛 주의 유닛**이 박힌다(시수=급여라 조용한 오기록).
    [planHandlers, applyMemorizedWords, data.canMarkAttendanceByDate, data.unitsByDate, classId, trackAttendanceSave, trackAttendanceCell, feedback, t, router, store, audit],
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
      // 감사로그 — 편집 전 값(칸을 떠날 때 한 줄). 칸마다 첫 값만 잡힌다.
      const prevGoal = goalsRef.current.find(
        (g) =>
          g.scope === scope && g.role === role && g.skillArea === skillArea && g.periodStart === periodStart,
      );
      audit.touch(
        classId,
        { kind: "goal", scope, periodStart, role, skillArea, field },
        prevGoal?.[field] ?? null,
      );
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
            tf("plan.feedback.notSavedRefresh", { error: feedback(r.error) }),
          );
      });
    },
    [audit, classId, data.monthStart, feedback, store, tf, weekMonday],
  );

  const saveWeekMemo = useCallback(
    (memoKey: string, body: string) => {
      // 감사로그 — 편집 전 값(칸을 떠날 때 한 줄).
      audit.touch(classId, { kind: "memo", weekStart: weekMonday, memoKey }, memosRef.current[memoKey] ?? null);
      setMemos((prev) => ({ ...prev, [memoKey]: body }));
      store.scheduleLww(`memo:${memoKey}`, async () => {
        const r = await saveMemo({
          classId,
          weekStart: weekMonday,
          memoKey,
          body,
        });
        if (!r.ok) toast.error(tf("plan.feedback.notSaved", { error: feedback(r.error) }));
      });
    },
    [audit, classId, feedback, store, tf, weekMonday],
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
    // onBlur = 칸 편집 감사로그의 "칸을 떠났다" 신호(자손·포털에서 올라온다 — use-sheet-edit-audit.ts).
    <div
      className={variant === "today" ? "flex flex-col gap-3" : "flex h-full min-h-0 flex-col gap-3"}
      onBlur={audit.onBlur}
    >
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

      {/* 읽기 권한 안내 — 계획·명단·좌측 패널 칸은 이미 잠겨 있지만 값이 차 있으면 왜 못 고치는지 모른다.
          칸마다 문구를 달지 않고 **시트에 한 줄만**(원장 2026-11-05 읽기 권한 규칙, src/lib/write-lock.ts).
          ⚠️ 주간 시트(full)에서만 — 오늘 면은 반마다 이 컴포넌트를 쌓으므로 페이지(ecs/page.tsx)가 한 번 띄운다. */}
      {/* 잠긴 이유를 가른다(2026-11-05 리뷰) — 쓰기 권한은 있는데 담당 반이 아니라 보기만 하는 경우(자리 화면의 남의 반 링크 등)에
          "작성 권한이 필요합니다"를 띄우면 이미 권한이 있는 사람에게 틀린 말이 된다. */}
      {variant === "full" && !canEdit ? <p className="text-text-dim px-1 text-sm">{data.scopeLocked ? ECS_SCOPE_LOCK_NOTE : writeLockedNote("ecs")}</p> : null}
      {/* 읽기 권한이면 그리지 않는다 — 저장 큐가 canEdit=false라 '복구해서 저장'을 눌러도 아무것도 저장되지 않는데
          "복구됨"이 떴다. 기기에 남은 기록은 지우지 않고 둔다(쓰기 권한이 돌아오면 그때 다시 뜬다). */}
      {doc.recoverable && canEdit ? (
        <div className="border-line bg-bg-soft flex flex-wrap items-center gap-2 rounded-2xl border border-dashed px-4 py-2.5 text-sm">
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
            복구 안 함
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
      {/* 폰(`phone:` = 최상위 프레임 <768px, 창 제외)은 계획 패널을 **시트 위에 쌓는다**(`phone:flex-col`) — 나란히 두면 패널
          300px이 폭을 먹어 시트가 54px로 짜부라졌다(2026-09-13 모바일 전수검사, 390px 실측). 패널 높이는 plan-panel.tsx가
          폰에서만 35vh로 캡. 🔴 `max-md:`가 아니다(창을 768 아래로 스냅하면 창 안까지 접힌다 — v5 ④ "창은 열 유지"). */}
      <div
        className={variant === "today" ? "min-w-0" : "flex min-h-0 flex-1 items-stretch gap-3 phone:flex-col"}
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
                  <span className="text-danger text-xs font-bold whitespace-nowrap">
                    저장 충돌 {saveIndicator.conflicts}건 — 충돌한 셀에서 서버값/내 값을 고르세요(이 화면에 안
                    보이면 주간 시트에서)
                  </span>
                ) : (
                  <span className="text-text-dim text-xs font-semibold whitespace-nowrap">저장 중…</span>
                )}
              </div>
            ) : null}
            {todayDay && todayDay.slots.length > 0 ? (
              <>
                <TodayClassSheet
                  day={todayDay}
                  header={
                    // 카드 바깥 제목 줄이 사라졌으므로 그 위계를 여기로 옮긴다 — 조각은 빈 카드와 공용.
                    <TodayCardHead className={data.className} href={`/ecs/${classId}?week=${weekMonday}`}>
                      <EditingBadge scope={ecsPresenceScope(classId, weekMonday)} />
                    </TodayCardHead>
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
                  shouting={shouting}
                />
                {/* ⚠️ 숨긴 남의 교시 각주는 **폐기**(원장 2026-08-19 "이 멘트 필요없음") — 되돌릴 곳
                    안내는 오늘 면 맨 위 한 줄이 대신한다(ecs/page.tsx). 여기 각주를 되살리지 말 것. */}
              </>
            ) : (
              // 🔴 빈 카드에도 **반 이름을 단다**(원장 2026-09-03 제보) — 없으면 그런 반이 둘일 때
              //    똑같은 회색 상자 두 개가 되어 어느 반인지 알 수 없다. 머리 줄은 정상 카드와 같은 조각.
              <div className="bg-card shadow-card space-y-2 rounded-2xl px-4 py-5">
                {/* 🔴 링크는 `hasHiddenOwn`일 때만 — 그 날 수업 자체가 없는 반은 주간 시트에 볼 것이
                    없어서, 링크를 걸면 **없는 것을 보러 가라고 보내는 셈**이다. */}
                <TodayCardHead
                  className={data.className}
                  href={hasHiddenOwn ? `/ecs/${classId}?week=${weekMonday}` : null}
                />
                <p className="text-text-dim text-sm">
                  {/* ⚠️ 원인을 뭉치지 않는다 — 반의 그 날 교시가 **전부 남의 것**이어서 빈 것과, 애초에
                      수업이 없는 것은 사람이 할 일이 다르다. "수업이 없습니다"로 뭉치면 거짓말이 된다. */}
                  {hasHiddenOwn ? t("today.card.noOwnSlots") : t("today.card.noClass")}
                </p>
              </div>
            )}
          </div>
        ) : (
          <>
            {panelOpen ? (
              <PlanPanel
                goals={goals}
                // 🔴 왼쪽 표 행만 트랙별 목록(EiE = 달력 칸) — 교시 계획 줄은 `data.skillAreas` 그대로다.
                skillAreas={data.goalAreas}
                canEdit={canEdit}
                lockedHint={data.scopeLocked ? ECS_SCOPE_LOCK_NOTE : undefined}
                monthStart={data.monthStart}
                weekMonday={weekMonday}
                memo={memos["panel"] ?? ""}
                onGoalField={saveGoal}
                onMemo={(body) => saveWeekMemo("panel", body)}
              />
            ) : null}
            {/* 폰은 위에 쌓인 계획 패널이 `h-full` 사슬의 남는 높이를 다 먹어 격자가 57px 띠로 남았다(실측 390px) — 격자를
                flex-none + 안쪽 스크롤러 `h-auto`로 풀어 **내용 높이만큼** 서게 하고 세로는 본문(main)이 스크롤한다(가로만 격자
                안에서). ⚠️ `min-h-[65vh]`로 두면 65vh 상자 안에서 또 세로 스크롤이 생겨 이중 스크롤이었다(적대 리뷰 실측: 안 799 >
                549). `[&>div]`는 DragScrollArea의 안쪽 스크롤러(`h-full`). 데스크톱은 종전대로 남는 높이 전부 + 안쪽 스크롤.
                `phone:pb-8` — 격자가 `h-full` 페이지 루트 밖으로 넘치므로 셸 main의 하단 여백(pb-8)이 격자 아래에 안 붙는다(재리뷰 실측:
                마지막 교시 행이 화면 바닥에 붙음) → 같은 값을 격자 상자 안에 둔다(design-conventions "본문 하단 여백"). */}
            <DragScrollArea barX className="min-w-0 flex-1 phone:flex-none phone:pb-8 phone:[&>div]:h-auto">
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
                shouting={shouting}
              />
            </DragScrollArea>
          </>
        )}
      </div>

      {/* 주 전체 집계 각주(시간표 밖 출석 기록) — **full 전용**. 하루짜리 오늘 변형 밑에 주 전체
          숫자를 깔면 그 날 화면과 숫자가 안 맞는 거짓 표시가 된다(적대 리뷰 2026-08-11). 오늘 면에는
          반마다 '주간 시트 열기' 링크가 있어 그쪽에서 그대로 보인다. */}
      {variant === "full" && data.grid.attendanceOnly.length > 0 ? (
        <div className="bg-card shadow-card rounded-2xl px-4 py-3 text-sm">
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
      {/* 🔴 시간표에 없는 시각(고아)은 카드도 각주도 세우지 않는다 — 원장 2026-09-23 *"앞으로 안뜨게하면 되고
          이전 데이터들은 무시해"*. 기록은 지우지 않고 `grid.strayRecords`에 그대로 남아 있다(작성률 분모 밖). */}

      {data.grid.hiddenSpecial.map((h) => (
        <p key={h.seat} className="text-text-dim px-1 text-xs">
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
