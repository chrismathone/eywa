"use client";

import { useCallback, useMemo, useState } from "react";
import { seatHasJjFields } from "@/features/attendance/seat/jj-fields";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON } from "@/components/toolbar-controls";
import { seatCellKey } from "@/features/attendance/seat/prev-period";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import { SeatPeriodChips } from "./seat-period-chips";
import { SEAT_NAME, type SeatKey } from "@/features/attendance/seat/seat";
import { ECS_PLAN_API } from "@/features/class-sheets/components/plan-api";
import { seatPlanApi } from "@/features/attendance/seat/seat-plan-api";
import type { SeatPeriodHintData } from "./seat-period-hints";
import { useSeatBoardSaves } from "./seat-board-saves";
import { useSeatPlacementMoves } from "./seat-board-moves";
import { SeatJjNote, SeatJjTable, type SeatPlanFold } from "./seat-jj-table";
import type { SeatClassPlan } from "@/features/attendance/seat/server/jj-plan";
import { SeatLabGrid } from "./seat-lab-grid";
import { writeLockedNote } from "@/lib/write-lock";
import {
  applySeatPlacements,
  mergeSeatPlacements,
  seatResetCounts,
  seatResetTargets,
  type SeatPlacement,
} from "@/features/attendance/seat/placement";
import {
  applySeatPeriodChoices,
  seatChoiceKey,
} from "@/features/attendance/seat/period-choice";

type PeriodChip = { start: string; ends: string[]; classIds: string[] };

/**
 * 보기만 되는 **이유** — 안내 문장과 칸 모양이 이유마다 다르다(원장 2026-11-05).
 *  · `"permission"` 자리 출석부 읽기 권한(서버 `gateSeatWrite`가 거절할 사람) — 세 단추 대신 상태 글자 + 권한 안내.
 *  · `"past"` 지난 날짜(쓰기 권한은 있는데 지난 날짜 쓰기는 사무실만) — 종전대로 잠긴 단추 + "지난 날짜는 보기만".
 * 🔴 사유를 섞어 말하지 말 것 — 권한이 없는 사람에게 "지난 날짜라서"라고 하면 오늘로 와서 다시 헛수고한다.
 */
export type SeatReadOnlyReason = "permission" | "past";

/** 보드 위 안내 한 줄 — 사유별 문장의 단일 소스(교시 하나·'전체' 보기·공개 화면이 같은 말을 한다). */
export function seatReadOnlyNote(reason: SeatReadOnlyReason): string {
  return reason === "permission"
    ? writeLockedNote("seat_attendance")
    : "지난 날짜는 보기만 가능합니다 — 수정이 필요하면 관리자에게 요청하세요.";
}

/**
 * 진도(수업계획)를 함께 그릴 때만 내려오는 재료 — **없으면 진도 구획이 아예 안 생긴다**.
 * 🔴 어느 반이 여기 실리는지는 **서버**가 정한다(로그인 = ECS 게이트 / 비로그인 PIN = 그날 그 교시
 *    명단 화이트리스트). 랩실은 어느 쪽이든 대상이 아니다(JJ 전용).
 */
type SeatPlans = {
  /** 반 id → 그 교시 계획. 키가 없는 반 = 그 사람이 계획을 볼 권한이 없는 반(서버가 정한다). */
  plans: Record<string, SeatClassPlan>;
  tenantId: string;
  /** 저널 문서 키의 사용자 축. 공개 PIN 화면은 계정이 없어 자리 키가 온다. */
  userId: string;
  /** 저널·presence 문서 키의 주차(월요일) — 영어 시트와 같은 값. */
  weekMonday: string;
  /**
   * 🔵 비로그인 공개 PIN 화면인가 — 저장이 나갈 **문**만 가른다(밑바닥은 같은 함수).
   * 문이 어긋나면 저장이 거절될 뿐 새는 쪽으로는 못 간다(ECS 문은 로그인을, PIN 문은 쿠키를 요구한다).
   */
  viaPin?: boolean;
};

/**
 * 자리 출석부 본문 — 교시 하나의 명단(반 그룹)을 그리고 그 자리에서 출결을 찍는다.
 *
 * 🔴 미체크는 **결석이 아니다**(아직 안 온 것). 자동 결석 판정은 없고, 결석은 사람이 누를 때만 찍힌다.
 * ⚠️ 낙관적 반영 — 32명을 훑는 화면이라 왕복을 기다리면 입실 줄이 밀린다. 실패하면 그 카드만 되돌린다.
 * JJ실은 여기에 듣기 레벨·누적 암기 단어수가 붙는다(랩실은 출결만).
 */
export function SeatBoard({
  seat,
  date,
  periods,
  activeStart,
  rosters,
  readOnly,
  readOnlyReason = "past",
  hrefFor,
  publicPin,
  prevAbsentByCell,
  nextStartByStudent,
  nextRoomByStudent,
  lastByStudent,
  plans,
  placements,
  canMove = false,
  placementNotice,
  showChips = true,
  showAllChip = false,
  periodChoices,
  slotsByClass,
  markedSlotsByCell,
  onClearPeriodChoices,
  canChoosePeriod = false,
  choicesApplied = false,
  foldPlans = false,
}: {
  seat: SeatKey;
  date: string;
  periods: PeriodChip[];
  activeStart: string;
  rosters: SeatClassRoster[];
  readOnly: boolean;
  /**
   * `readOnly`일 때 그 이유(`SeatReadOnlyReason`) — page.tsx가 서버 게이트(`gateSeatWrite`)와 같은 판정으로 정한다.
   * 생략하면 종전 의미(지난 날짜)다.
   */
  readOnlyReason?: SeatReadOnlyReason;
  hrefFor: string;
  /**
   * 앞 교시가 결석인 칸 → 그 교시 시각(`classId|studentId` → "HH:MM", `prevPeriodAbsences`).
   * 🔴 서버가 만든 **제안**일 뿐이다 — 이 값으로 아무것도 자동 저장하지 않는다(버튼을 눌러야 쓴다).
   * ⚠️ 상태로 안 걸러진 채 온다 — 낙관 오버레이(`statusOf`)를 얹은 뒤 화면이 다시 거른다.
   */
  prevAbsentByCell?: Readonly<Record<string, string>>;
  /**
   * 학생 id → 오늘 남은 **다음 수업** 시작시각("HH:MM") — 이 자리만이 아니라 오늘 전 과목에서 찾는다.
   * 🔴 **로그인 화면과 공개 PIN 랩실**(`PIN_NOTE_SEATS`, 원장 2026-09-10 *"seat/lab에서도 자리 출석부와 동일해야해"*)에
   *    내려온다 — JJ실 PIN 화면은 이 prop을 안 받는다(그 문엔 새 정보를 내려보내지 않는다는 규약. 사유 칸과 같은 결).
   */
  nextStartByStudent?: Readonly<Record<string, string>>;
  /**
   * 학생 id → 그 다음 수업의 **강의실 이름**(등록된 정본). 모르면 키가 없다 — 화면은 시각만 적는다.
   * 🔴 `nextStartByStudent`와 같은 규약으로 내려온다(로그인 화면 · 공개 PIN 랩실).
   */
  nextRoomByStudent?: Readonly<Record<string, string>>;
  /**
   * 학생 id → true — 이 교시가 오늘 **마지막 수업**이라고 **확인된** 학생(원장 2026-09-11). 같은 규약으로 내려온다.
   * 🔴 `nextStartByStudent`에 없다고 마지막이 아니다(조회 안 함·실패·대상 밖 = 모름) — 이 값만 보고 적는다.
   */
  lastByStudent?: Readonly<Record<string, true>>;
  /**
   * 비로그인 PIN 화면인가 — 참이면 **사유 칸을 안 그린다**(그 경로는 사유를 조회하지 않는다).
   * ⚠️ `plans.viaPin`으로 대신 판정하지 말 것 — 계획이 없는 자리·교시엔 `plans` 자체가 안 넘어와서
   *    공개 화면인데도 거짓이 된다.
   */
  publicPin?: boolean;
  plans?: SeatPlans;
  /**
   * 자리 **배치**(드래그로 옮긴 자리, 0254a) — 서버가 준 줄. `undefined`면 배치 축 자체가 없다.
   * 🔴 출결 귀속이 아니다(`placement.ts` 머리 주석) — 옮겨도 저장은 언제나 원래 반으로 나간다.
   */
  placements?: readonly SeatPlacement[];
  /**
   * 이미 옮겨 둔 자리(배치 0254a)의 [초기화]를 열 것인가 — **로그인 + 쓰기 가능 + 0254a 적용됨**일 때만 참.
   * 배치를 새로 만드는 드래그는 없다(원장 2026-09-11) — 이 값은 되돌리기만 연다.
   * 🔴 비로그인 PIN 화면은 언제나 거짓이다(감사로그에 실행자를 못 남기는 동작은 열지 않는다).
   */
  canMove?: boolean;
  /** 배치를 못 쓰는 이유(한글) — 있으면 한 줄로 알린다. 없으면 아무 말도 안 한다. */
  placementNotice?: string | null;
  /** 교시 칩 줄을 여기서 그릴 것인가 — '전체' 보기는 페이지가 위에 한 번만 그린다. */
  showChips?: boolean;
  /** 칩 줄에 '전체'를 세울 것인가 — 로그인 화면은 랩실·JJ실 모두, 공개 PIN은 랩실만(페이지가 정한다). */
  showAllChip?: boolean;
  /**
   * **교시 선택**(0255a) — `반id|학생id` → 그 학생이 설 교시. 이미 그 날짜로 접힌 값이다
   * (하루짜리 > 상시 고정, `resolveSeatPeriodChoices`).
   * 🔑 `choicesApplied`가 참이면 `rosters`가 이미 얹은 결과라 여기선 **세는 데만** 쓴다([교시 지정 N명 해제]).
   *    거짓이면(공개 PIN 화면) 이 교시 명단만으로 **감추기만** 한다 — 다른 시간에서 옮겨 온 학생을 세울
   *    재료(다른 교시 명단)가 여기 없다.
   */
  periodChoices?: Readonly<Record<string, string>>;
  /** 반 id → 그 날 이 자리에 걸린 교시들. 선택이 그 날 없는 교시를 가리키면 **선택을 버린다**. */
  slotsByClass?: Readonly<Record<string, readonly string[]>>;
  /** `반id|학생id` → 이미 기록이 있는 교시들. **사실이 규칙을 이긴다**(기록 있는 칸은 안 감춘다). */
  markedSlotsByCell?: Readonly<Record<string, readonly string[]>>;
  /** 그 반의 교시 지정(오늘 이동 + 이 요일 고정)을 지운다. 없으면 [해제] 버튼을 안 세운다. */
  onClearPeriodChoices?: (classId: string) => void;
  /**
   * 카드를 집을 수 있나 — 교시 이동(0255a)의 가용성. 드롭·판정은 바깥 `SeatAllDay` 컨텍스트 한 벌이 받는다(원장
   * 2026-09-11 *"LAB실에서 내가 드래그하고 싶은건, '다른 시간대'의 수업임"* — 교시 하나 보기에서도 교시 칩에 놓아 옮긴다).
   * 🔴 배치(0254a) 가용성과 **따로**다 — 배치를 새로 만드는 드래그는 없어서 0254a가 안 돌아도 교시 이동은 산다.
   */
  canChoosePeriod?: boolean;
  /**
   * `rosters`가 이미 **교시 선택을 얹은** 명단인가(감추기 + 다른 시간에서 옮겨 온 묶음) — 서버(교시 하나 보기
   * `applySeatDayChoices`)나 '전체' 보기가 하루치 순수 함수로 만든 결과를 넘길 때 참.
   * 🔴 참인데 여기서 다시 거르면 옮겨 온 학생이 사라지지는 않지만(`visiting` 묶음은 건너뛴다) 두 번 판정한다.
   *    거짓이면(공개 PIN 화면) 이 교시 명단만으로 **감추기만** 한다 — 옮겨 온 학생을 세울 재료가 여기 없다.
   */
  choicesApplied?: boolean;
  /**
   * 수업계획(진도) 구획을 **접은 채** 시작한다 — JJ실 '전체' 보기만(원장 2026-09-18 *"펼치기"* — 하루치 교시가 다 서니
   * 계획 표까지 모두 펴면 화면이 계획으로 덮인다). 펴는 문은 둘: 카드마다의 접기 줄(**반마다**, 원장 같은 날 *"각각의
   * 수업이 펼치기 접기가 되어야함"*) + 요약 줄의 [수업계획 모두 펼치기]. 교시 하나 보기는 종전대로 늘 편다.
   * 🔑 펼친 적 없는 반의 계획 블록은 **올리지도 않는다**(저널·저장 큐·presence가 블록마다 붙는다).
   */
  foldPlans?: boolean;
}) {
  const {
    pending,
    error,
    statusOf,
    noteOf,
    mergeFields,
    save,
    saveNote,
    fill,
    fillPrevAbsent,
    saveField,
    flushFields,
    applyCarried,
    onBlur: auditBlur,
  } = useSeatBoardSaves(seat, date, activeStart);
  /** 읽기 권한 때문에 보기만인가 — 칸이 세 단추 대신 상태 글자를, 입력칸이 권한 안내 placeholder를 쓴다. */
  const writeLocked = readOnly && readOnlyReason === "permission";
  const showJj = seatHasJjFields(seat);
  /**
   * 접힘 — 교시 판마다 제 것이고 그 안에서 **반마다 따로**다(원장 2026-09-18 *"각각의 수업이 펼치기 접기가
   * 되어야함. 당일"*). 키가 없는 반은 접힌 것(`foldPlans`일 때만 이 상태가 쓰인다).
   * 🔑 한 번 펼친 블록은 접어도 **내리지 않는다**(`SeatPlanFold` 주석) — 그래서 `mounted`가 따로 있다.
   */
  const [planOpenBy, setPlanOpenBy] = useState<Record<string, boolean>>({});
  const [planMountedBy, setPlanMountedBy] = useState<Record<string, boolean>>({});
  /** 한 반 블록을 올린다 — 내리는 짝은 **없다**(위 🔑). */
  const mountPlan = useCallback((classId: string) => {
    setPlanMountedBy((m) => (m[classId] ? m : { ...m, [classId]: true }));
  }, []);
  const togglePlan = useCallback(
    (classId: string) => {
      mountPlan(classId);
      setPlanOpenBy((o) => ({ ...o, [classId]: !o[classId] }));
    },
    [mountPlan],
  );
  /**
   * 반마다 계획 저장 충돌 수 — 🔴 충돌은 계획 블록 **안에만** 표시되고 토스트가 없다. 접힌 채 두면 저장이 멈춘 걸 아무도
   * 모르므로(적대 리뷰 2026-09-18) **접힌 버튼이 그 수를 붉게 말한다**.
   * ⚠️ 접기를 잠그지는 않는다 — 이 화면에서 못 푸는 충돌(지운 줄·복구로 들어온 다른 교시 칸)이 남으면 새로고침 전까지
   *    영영 잠긴다(재리뷰 2026-09-18).
   */
  const [planConflicts, setPlanConflicts] = useState<Record<string, number>>({});
  const onPlanConflicts = useCallback(
    (classId: string, count: number) =>
      setPlanConflicts((m) => ((m[classId] ?? 0) === count ? m : { ...m, [classId]: count })),
    [],
  );
  // 요약 칩의 충돌 수는 **아직 접힌 반**만 더한다 — 펼친 반의 충돌은 블록 안에 보이므로, 합치면 접힌 반에 충돌이 있는
  // 것처럼 읽힌다(재리뷰 2026-09-18).
  const conflictN = Object.entries(planConflicts)
    .filter(([id]) => !planOpenBy[id])
    .reduce((a, [, n]) => a + n, 0);
  const planFold: SeatPlanFold | undefined = useMemo(
    () =>
      foldPlans
        ? {
            openOf: (classId: string) => planOpenBy[classId] ?? false,
            mountedOf: (classId: string) => planMountedBy[classId] ?? false,
            conflictsOf: (classId: string) => planConflicts[classId] ?? 0,
            toggle: togglePlan,
          }
        : undefined,
    [foldPlans, planOpenBy, planMountedBy, planConflicts, togglePlan],
  );
  // 문 선택은 여기 한 줄 — 참조 고정(계획 블록이 `memo`라 매 렌더 새 객체면 표가 통째로 다시 그려진다).
  const viaPin = plans?.viaPin ?? false;
  const planApi = useMemo(() => (viaPin ? seatPlanApi(seat) : ECS_PLAN_API), [viaPin, seat]);
  // ⚠️ 참조 고정 — 계획 블록이 `memo`라, 매 렌더 새 객체를 만들면 학생 칸을 칠 때마다 계획 표가 다시 그려진다.
  const planContext = useMemo(
    () =>
      plans
        ? {
            plans: plans.plans,
            api: planApi,
            tenantId: plans.tenantId,
            userId: plans.userId,
            weekMonday: plans.weekMonday,
            date,
            slotStart: activeStart,
            onCarried: applyCarried,
            flushFields,
          }
        : undefined,
    [plans, planApi, date, activeStart, applyCarried, flushFields],
  );
  const { overlay, movePending, moveError, resetPlacements } = useSeatPlacementMoves(seat, date, activeStart);
  /**
   * 교시 지정 해제 — 교시를 옮길 수 있는 화면(랩실 로그인)은 두 보기 모두 `SeatAllDay`가 낙관 오버레이째로 제 것을
   * 넘겨준다(2026-09-11부터 교시 하나 보기도 그 한 벌이다). 🔴 없으면 [해제]를 안 세운다(공개 PIN·JJ실 — 옮길 수 없는 화면).
   */
  const clearPeriod = onClearPeriodChoices;
  /**
   * **교시 선택**(0255a)을 먼저 얹는다 — 다른 교시로 정해진 학생을 이 교시 명단에서 뺀다.
   * 🔴 배치(반 묶음)보다 **앞이다** — 감춰진 학생을 옮길 수는 없으니, 순서가 뒤집히면 없는 카드에
   *    배치를 얹는 꼴이 된다. 선택이 없으면 결과는 입력과 글자 그대로 같다.
   */
  const inPeriod =
    choicesApplied || !periodChoices
      ? rosters
      : applySeatPeriodChoices(rosters, {
          slotStart: activeStart,
          choices: periodChoices,
          slotsByClass: slotsByClass ?? {},
          markedSlotsByCell: markedSlotsByCell ?? {},
          // 🔑 칩 줄의 교시가 곧 그날 이 자리의 교시다 — 다른 시간으로 옮긴 학생도 제 교시에서 감춘다
          //    (서버 `rosterKeys`가 그 칸을 거절하므로, 보이게 두면 누르는 순간 에러가 난다).
          periodStarts: periods.length > 0 ? periods.map((p) => p.start) : undefined,
        });
  const raw = mergeFields(inPeriod);
  /**
   * 배치를 얹은 명단 — 서버 줄 + 화면 오버레이를 합쳐 **순수 함수 한 벌**로 그린다.
   * 🔴 학생마다 `homeClassId`(원래 반)가 붙는다 — 아래 모든 조회·저장은 묶음 id가 아니라 그 값을 쓴다.
   * ⚠️ 배치가 없으면(JJ실·평소) 결과는 입력과 글자 그대로 같다(`homeClassId === classId`).
   */
  const placed = applySeatPlacements(raw, mergeSeatPlacements(raw, placements ?? [], overlay));
  const view = placed.rosters;
  /** 이 교시에서 계획을 볼 수 있는 반 수 — 0이면 펼칠 것이 없어 버튼을 안 세운다(어느 반이 실리는지는 서버가 정했다). */
  /**
   * 이 교시에서 계획 구획이 서는 반 — 접기 줄(반별)과 '모두' 버튼이 이 집합을 쓴다.
   * ⚠️ 같은 반이 한 교시에 두 줄로 설 수 있어(중복 슬롯) id로 거른다 — 접힘은 반 id 키라 두 카드가 함께 열린다.
   */
  const planClassIds = plans ? [...new Set(view.filter((r) => plans.plans[r.classId]).map((r) => r.classId))] : [];
  const planClassN = planClassIds.length;
  /** 아직 접혀 있는 반 수 — '모두' 버튼은 **남은 것**을 편다(일부만 열린 상태에서 "N개 반"이 거짓이 되지 않게). */
  const closedPlanN = planClassIds.filter((id) => !planOpenBy[id]).length;
  const allPlansOpen = planClassN > 0 && closedPlanN === 0;
  const toggleAllPlans = () => {
    const open = !allPlansOpen;
    if (open) for (const id of planClassIds) mountPlan(id);
    setPlanOpenBy((o) => {
      const next = { ...o };
      for (const id of planClassIds) next[id] = open;
      return next;
    });
  };
  const resetCounts = seatResetCounts(placed.applied);
  /**
   * 반별 **이 교시로 지정된** 학생 수 — 머리줄 [교시 지정 N명 해제]가 그대로 쓴다.
   * 🔑 지정된 학생은 **지금 이 교시에만** 서 있으므로, 버튼도 그 교시에서만 뜬다(감춰진 교시에
   *    버튼이 서면 아무도 없는 반에 [해제]가 붙는다).
   */
  const periodChoiceCounts = periodChoices
    ? view.reduce<Record<string, number>>((acc, r) => {
        for (const s of r.students) {
          // 🔴 세는 축은 묶음(`r.classId`)이 아니라 **원래 반**이다 — 배치로 남의 묶음에 앉은 학생을
          //    묶음 축으로 세면 [해제]가 엉뚱한 반에 붙고, 누르면 남의 반 지정을 지운다.
          if (periodChoices[seatChoiceKey(s.homeClassId, s.id)] !== activeStart) continue;
          acc[s.homeClassId] = (acc[s.homeClassId] ?? 0) + 1;
        }
        return acc;
      }, {})
    : {};
  const resetAllTargets = seatResetTargets(placed.applied);
  const all = view.flatMap((r) => r.students.map((s) => statusOf(s.homeClassId, s)));
  const total = all.length;
  const checked = all.filter((v) => v !== null).length;
  const waiting = total - checked;
  /**
   * 앞 교시 결석자 중 **아직 안 찍힌 칸** 수 — 버튼 라벨이 이 수를 그대로 쓴다.
   * 🔴 낙관 오버레이(`statusOf`)를 얹은 뒤 센다 — 방금 출석으로 고친 학생이 그 수에 남아 있으면
   *    버튼이 거짓말을 한다. 0이면 버튼을 아예 세우지 않는다.
   * 🔴 **칸 키로 중복을 접는다** — 같은 반이 한 교시에 두 줄로 서면(중복 슬롯) 명단에 같은 학생이 두 번
   *    들어와 라벨이 "4명"이라 적고 서버는 2건만 쓴다(서버도 같은 키로 접는다, `prevAbsentFillTargets`).
   */
  const prevAbsentWaiting = prevAbsentByCell
    ? new Set(
        view.flatMap((r) =>
          r.students
            .filter(
              (s) =>
                statusOf(s.homeClassId, s) === null && prevAbsentByCell[seatCellKey(s.homeClassId, s.id)],
            )
            .map((s) => seatCellKey(s.homeClassId, s.id)),
        ),
      ).size
    : 0;
  /** 표 두 벌에 그대로 넘기는 신호 한 묶음 — 이름은 자리 키가 아니라 사람이 읽는 방 이름이다. */
  const hints: SeatPeriodHintData = {
    prevAbsentByCell,
    nextStartByStudent,
    nextRoomByStudent,
    lastByStudent,
    seatName: SEAT_NAME[seat],
  };
  const listenN = view.flatMap((r) => r.students).filter((s) => s.listeningLevel).length;
  const wordsN = view.flatMap((r) => r.students).filter((s) => s.memorizedWords).length;

  return (
    // onBlur = JJ 칸 감사로그의 "칸을 떠났다" 신호(자손에서 올라온다 — use-sheet-edit-audit.ts).
    <div className="flex min-h-0 flex-1 flex-col gap-3" onBlur={auditBlur}>
      {/* '전체' 보기에선 칩 줄을 **페이지가 위에 한 번만** 그린다 — 교시마다 반복되면 화면이 칩으로 덮인다. */}
      {showChips ? (
        <SeatPeriodChips periods={periods} activeStart={activeStart} hrefFor={hrefFor} showAll={showAllChip} />
      ) : null}

      <div className="bg-card shadow-card flex shrink-0 flex-wrap items-center gap-3 rounded-2xl px-4 py-2.5">
        <span className="text-foreground text-base font-bold tabular-nums">
          {activeStart}
          {view.length > 0 ? (
            <span className="text-text-dim ml-2 text-xs font-medium">
              {view.length}개 반 · {total}명
            </span>
          ) : null}
        </span>
        <span className="text-text-dim text-xs">
          체크 <strong className="text-foreground tabular-nums">{checked}</strong> / {total}
          {waiting > 0 ? <span className="ml-2">대기 {waiting}명</span> : null}
          {showJj ? (
            <span className="ml-2">
              듣기 {listenN} · 단어 {wordsN}
            </span>
          ) : null}
        </span>
        {foldPlans && planClassN > 0 ? (
          // 일괄 동작이라 `aria-expanded`를 달지 않는다 — 일부만 열린 상태에서 그 값이 거짓이 된다(재리뷰 2026-09-18).
          // 반마다의 열림은 카드의 접기 줄이 말한다.
          <button
            type="button"
            onClick={toggleAllPlans}
            title={
              allPlansOpen
                ? "이 교시의 수업계획을 모두 접습니다 — 적어 둔 내용은 그대로입니다"
                : conflictN > 0
                  ? "수업계획에 저장이 멈춘 칸이 있습니다 — 펼쳐서 충돌한 칸의 서버값/내 값을 고르세요"
                  : `이 교시에서 아직 접힌 ${closedPlanN}개 반의 수업계획을 한 번에 펼칩니다(반마다 따로도 됩니다)`
            }
            className={`${TOOLBAR_CHIP} ${
              allPlansOpen ? TOOLBAR_CHIP_ON : conflictN > 0 ? "border-danger text-danger" : TOOLBAR_CHIP_OFF
            } font-semibold`}
          >
            {allPlansOpen
              ? "수업계획 모두 접기"
              : conflictN > 0
                ? `수업계획 모두 펼치기 · 저장 충돌 ${conflictN}건`
                : `수업계획 모두 펼치기 · ${closedPlanN}개 반`}
          </button>
        ) : null}
        {(!readOnly && waiting > 0) || (canMove && resetAllTargets.length > 0) ? (
          <div className="ml-auto flex flex-wrap gap-2">
            {/* 🔴 **되돌릴 것이 있을 때만** 선다(원장 2026-09-10 *"반별 '초기화' 단체 '초기화'"*). 반별과
                같은 서버 액션·같은 판정이고 범위만 다르다 — 그래서 반별 건수의 합이 언제나 이 수와 같다.
                🔴 확인은 **전체에만** 둔다(반별은 대상이 적고 되돌리기 쉽다). */}
            {canMove && resetAllTargets.length > 0 ? (
              <button
                type="button"
                disabled={movePending}
                onClick={() => {
                  if (
                    !window.confirm(
                      `이 교시에서 드래그로 옮긴 ${resetAllTargets.length}명을 원래 반으로 되돌립니다.\n이미 찍힌 출결은 그대로 남습니다. 계속할까요?`,
                    )
                  )
                    return;
                  resetPlacements(
                    resetAllTargets.map((t) => t.studentId),
                  );
                }}
                title="이 교시에서 드래그로 옮긴 자리를 전부 원래 반으로 되돌립니다 — 출결 기록은 그대로입니다"
                className={`${TOOLBAR_CHIP} border-line bg-card text-text-dim font-semibold disabled:opacity-50`}
              >
                전체 초기화 {resetAllTargets.length}명
              </button>
            ) : null}
            {!readOnly && waiting > 0 ? (
              <>
            {/* 🔴 '자동 결석'이 아니라 **사람이 누르는 한 번**이다(원장 2026-09-10 지시의 안전한 형태).
                후보가 0명이면 아예 안 선다 — 세워 두고 "0명"이라 적으면 화면이 거짓말을 한다. */}
            {prevAbsentWaiting > 0 ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => fillPrevAbsent()}
                title="앞 교시에 결석으로 찍힌 학생 중 이 교시가 아직 비어 있는 칸만 결석으로 채웁니다 — 이미 찍힌 칸은 건드리지 않습니다"
                className={`${TOOLBAR_CHIP} border-att-absent text-att-absent-ink font-semibold disabled:opacity-50`}
              >
                앞 교시 결석자 {prevAbsentWaiting}명 결석
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending}
              onClick={() => fill("present")}
              className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_ON} font-semibold disabled:opacity-50`}
            >
              남은 {waiting}명 출석
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => fill("absent")}
              className={`${TOOLBAR_CHIP} border-att-absent text-att-absent-ink font-semibold disabled:opacity-50`}
            >
              남은 {waiting}명 결석
            </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* '전체' 보기(칩 줄을 바깥이 그린다)에선 바깥이 위에 한 번만 적는다 — 교시마다 같은 문장이 서지 않게. */}
      {showJj && showChips ? <SeatJjNote /> : null}
      {readOnly ? (
        <p className="text-text-dim bg-bg-soft/60 border-line rounded-xl border px-3 py-2 text-xs">
          {seatReadOnlyNote(readOnlyReason)}
        </p>
      ) : null}
      {error ? (
        <p className="text-att-absent-ink bg-att-absent/30 border-att-absent rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}
      {/* 🔵 배치 [초기화] 실패는 출결 실패와 **다른 줄**로 알린다 — 두 축이 섞이면 무엇이 안 됐는지 모른다. */}
      {moveError ? (
        <p className="text-att-absent-ink bg-att-absent/30 border-att-absent rounded-xl border px-3 py-2 text-xs">
          {moveError}
        </p>
      ) : null}
      {/* 0254a가 아직 안 돌았거나 조회가 실패했을 때 — 화면은 그대로 살고 배치 [초기화]만 잠긴다([[#95]]). */}
      {placementNotice ? (
        <p className="text-text-dim bg-bg-soft/60 border-line rounded-xl border px-3 py-2 text-xs">
          {placementNotice}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {showJj ? (
          <SeatJjTable
            rosters={view}
            plan={planContext}
            planFold={planFold}
            onPlanConflicts={foldPlans ? onPlanConflicts : undefined}
            statusOf={statusOf}
            noteOf={noteOf}
            onSave={save}
            onSaveNote={saveNote}
            showReason={!publicPin}
            hints={hints}
            onSaveField={saveField}
            onFillClass={(classId) => fill("present", classId)}
            readOnly={readOnly}
            writeLocked={writeLocked}
            pending={pending}
          />
        ) : (
          <SeatLabGrid
            rosters={view}
            statusOf={statusOf}
            noteOf={noteOf}
            onSave={save}
            onSaveNote={saveNote}
            showReason={!publicPin}
            hints={hints}
            onFillClass={(classId) => fill("present", classId)}
            readOnly={readOnly}
            writeLocked={writeLocked}
            pending={pending || movePending}
            canMove={canMove}
            onResetClass={(classId) =>
              resetPlacements(
                seatResetTargets(placed.applied, classId).map((t) => t.studentId),
                classId,
              )
            }
            resetCounts={resetCounts}
            periodStart={activeStart}
            // 🔑 손잡이 = 교시 이동 가용성 하나 — 드롭·판정은 바깥 `SeatAllDay`가 받는다(원장 2026-09-11).
            canDrag={canChoosePeriod}
            periodChoiceCounts={periodChoiceCounts}
            onClearPeriodChoices={clearPeriod}
          />
        )}
      </div>
    </div>
  );
}
