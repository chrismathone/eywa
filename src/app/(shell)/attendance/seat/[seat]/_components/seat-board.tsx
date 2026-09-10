"use client";

import { useMemo } from "react";
import { seatHasJjFields } from "@/features/attendance/seat/jj-fields";
import { seatCellKey } from "@/features/attendance/seat/prev-period";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import { SeatPeriodChips } from "./seat-period-chips";
import { SEAT_NAME, type SeatKey } from "@/features/attendance/seat/seat";
import { ECS_PLAN_API } from "@/features/class-sheets/components/plan-api";
import { seatPlanApi } from "@/features/attendance/seat/seat-plan-api";
import type { SeatPeriodHintData } from "./seat-mark-extras";
import { useSeatBoardSaves } from "./seat-board-saves";
import { useSeatPlacementMoves } from "./seat-board-moves";
import { SeatJjTable } from "./seat-jj-table";
import type { SeatClassPlan } from "@/features/attendance/seat/server/jj-plan";
import { SeatLabGrid } from "./seat-lab-grid";
import {
  applySeatPlacements,
  mergeSeatPlacements,
  seatResetCounts,
  seatResetTargets,
  type SeatPlacement,
} from "@/features/attendance/seat/placement";

type PeriodChip = { start: string; ends: string[]; classIds: string[] };

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
  hrefFor,
  publicPin,
  prevAbsentByCell,
  nextStartByStudent,
  nextRoomByStudent,
  plans,
  placements,
  canMove = false,
  placementNotice,
  showChips = true,
  showAllChip = false,
}: {
  seat: SeatKey;
  date: string;
  periods: PeriodChip[];
  activeStart: string;
  rosters: SeatClassRoster[];
  readOnly: boolean;
  hrefFor: string;
  /**
   * 앞 교시가 결석인 칸 → 그 교시 시각(`classId|studentId` → "HH:MM", `prevPeriodAbsences`).
   * 🔴 서버가 만든 **제안**일 뿐이다 — 이 값으로 아무것도 자동 저장하지 않는다(버튼을 눌러야 쓴다).
   * ⚠️ 상태로 안 걸러진 채 온다 — 낙관 오버레이(`statusOf`)를 얹은 뒤 화면이 다시 거른다.
   */
  prevAbsentByCell?: Readonly<Record<string, string>>;
  /**
   * 오늘 이 자리에서 다시 오는 다음 교시(학생 id → "HH:MM").
   * 🔴 **로그인 화면에만 내려온다** — 비로그인 PIN 화면은 이 prop 자체를 안 받는다(그쪽엔 새 정보를
   *    내려보내지 않는다는 규약. 사유 칸과 같은 결).
   */
  nextStartByStudent?: Readonly<Record<string, string>>;
  /**
   * 학생 id → 그 다음 수업의 **강의실 이름**(등록된 정본). 모르면 키가 없다 — 화면은 시각만 적는다.
   * 🔴 `nextStartByStudent`와 같은 규약으로 **로그인 화면에만** 내려온다.
   */
  nextRoomByStudent?: Readonly<Record<string, string>>;
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
   * 드래그·초기화를 열 것인가 — **로그인 + 쓰기 가능 + 0254a 적용됨**일 때만 참.
   * 🔴 비로그인 PIN 화면은 언제나 거짓이다(감사로그에 실행자를 못 남기는 동작은 열지 않는다).
   */
  canMove?: boolean;
  /** 배치를 못 쓰는 이유(한글) — 있으면 한 줄로 알린다. 없으면 아무 말도 안 한다. */
  placementNotice?: string | null;
  /** 교시 칩 줄을 여기서 그릴 것인가 — '전체' 보기는 페이지가 위에 한 번만 그린다. */
  showChips?: boolean;
  /** 칩 줄에 '전체'를 세울 것인가(랩실만). */
  showAllChip?: boolean;
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
  } = useSeatBoardSaves(seat, date, activeStart);
  const showJj = seatHasJjFields(seat);
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
  const { overlay, movePending, moveError, moveStudent, resetPlacements } = useSeatPlacementMoves(
    seat,
    date,
    activeStart,
  );
  const raw = mergeFields(rosters);
  /**
   * 배치를 얹은 명단 — 서버 줄 + 화면 오버레이를 합쳐 **순수 함수 한 벌**로 그린다.
   * 🔴 학생마다 `homeClassId`(원래 반)가 붙는다 — 아래 모든 조회·저장은 묶음 id가 아니라 그 값을 쓴다.
   * ⚠️ 배치가 없으면(JJ실·평소) 결과는 입력과 글자 그대로 같다(`homeClassId === classId`).
   */
  const placed = applySeatPlacements(raw, mergeSeatPlacements(raw, placements ?? [], overlay));
  const view = placed.rosters;
  const resetCounts = seatResetCounts(placed.applied);
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
    seatName: SEAT_NAME[seat],
  };
  const listenN = view.flatMap((r) => r.students).filter((s) => s.listeningLevel).length;
  const wordsN = view.flatMap((r) => r.students).filter((s) => s.memorizedWords).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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
                className="border-line bg-card text-text-dim rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50"
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
                className="border-att-absent text-att-absent-ink rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50"
              >
                앞 교시 결석자 {prevAbsentWaiting}명 결석
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending}
              onClick={() => fill("present")}
              className="border-primary bg-primary text-primary-foreground rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              남은 {waiting}명 출석
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => fill("absent")}
              className="border-att-absent text-att-absent-ink rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              남은 {waiting}명 결석
            </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {showJj ? (
        <p className="text-text-dim px-1 text-xs">
          듣기 레벨·누적 암기 단어수는 영어 시트 JJ 칸과 같은 기록입니다.
        </p>
      ) : null}
      {readOnly ? (
        <p className="text-text-dim bg-bg-soft/60 border-line rounded-xl border px-3 py-2 text-xs">
          지난 날짜는 보기만 가능합니다 — 수정이 필요하면 관리자에게 요청하세요.
        </p>
      ) : null}
      {error ? (
        <p className="text-att-absent-ink bg-att-absent/30 border-att-absent rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}
      {/* 🔵 배치(드래그) 실패는 출결 실패와 **다른 줄**로 알린다 — 두 축이 섞이면 무엇이 안 됐는지 모른다. */}
      {moveError ? (
        <p className="text-att-absent-ink bg-att-absent/30 border-att-absent rounded-xl border px-3 py-2 text-xs">
          {moveError}
        </p>
      ) : null}
      {/* 0254a가 아직 안 돌았거나 조회가 실패했을 때 — 화면은 그대로 살고 드래그·초기화만 잠긴다([[#95]]). */}
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
            statusOf={statusOf}
            noteOf={noteOf}
            onSave={save}
            onSaveNote={saveNote}
            showReason={!publicPin}
            hints={hints}
            onSaveField={saveField}
            onFillClass={(classId) => fill("present", classId)}
            readOnly={readOnly}
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
            pending={pending || movePending}
            canMove={canMove}
            onMove={(studentId, toClassId) => {
              const home = view
                .flatMap((r) => r.students)
                .find((s) => s.id === studentId)?.homeClassId;
              if (!home) return;
              moveStudent(studentId, toClassId, home);
            }}
            onResetClass={(classId) =>
              resetPlacements(
                seatResetTargets(placed.applied, classId).map((t) => t.studentId),
                classId,
              )
            }
            resetCounts={resetCounts}
          />
        )}
      </div>
    </div>
  );
}
