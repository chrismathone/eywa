"use client";

/**
 * 수업계획 줄의 **단일 기계** — 셀 편집(CAS)·줄 추가/삭제/시기 이동(RPC)·내용 복사(RPC)를 한 벌로 묶는다.
 *
 * 🔑 왜 훅으로 뺐나: 이 로직을 화면마다 다시 적으면 같은 `class_sheet_plan_lines`를 **서로 다른 규칙**으로
 *    쓰게 된다(줄 번호·시기·CAS 기대값·복사 후 재시드). 한쪽만 고쳐지는 순간 조용히 갈린다.
 *    지금 쓰는 곳 = 주간/오늘 시트([sheet-client](./sheet-client.tsx))와
 *    자리 출석부 JJ 열([slot-plan-block](./slot-plan-block.tsx)).
 *
 * 🔴 **저장 경로는 여기서 끝이다** — 새 서버 액션·RPC를 만들지 말 것. 셀 = CAS 배치,
 *    구조 = `ecs_*` RPC, 복사 = `ecs_copy_slot`.
 * 🔑 **문(게이트)만 갈린다** — 어느 액션으로 나갈지는 호출부가 넘긴 [`api`](./plan-api.ts)가 정한다:
 *    로그인은 `ECS_PLAN_API`(→ `requireEcsClassAccess`), 비로그인 공개 자리 화면(`/seat/jj`)은
 *    `seatPlanApi(seat)`(→ 자리 PIN 쿠키 + 오늘 + 그 교시 명단). 두 문 뒤의 밑바닥은 같은 함수다(#77).
 *
 * ⚠️ 원스크린 오늘 보드의 [today-plan-editor](./today-plan-editor.tsx)는 **줄 구조를 안 바꾸는** 좁은 폼이라
 *    이 훅을 쓰지 않고 저장 큐(CAS)와 복사 버튼만 공유한다 — 구조 변경을 그쪽에 붙일 땐 이 훅으로 올릴 것.
 *
 * 호스트가 넘기는 것:
 *  · `onSlotLines(planDate, slotStart, lines)` — 서버가 돌려준 **canonical 행**으로 그 교시 상태 교체.
 *  · `onCarried(planDate, slotStart, patches)` — JJ 이어받기(듣기 레벨·누적 암기 단어수)를 화면 상태에 머지.
 *    🔴 마크는 클라 state라 `router.refresh()`로는 안 바뀐다 — 안 머지하면 "복사했는데 칸이 그대로"가 된다.
 *  · `flushHost()`(선택) — 호스트가 따로 들고 있는 저장 큐를 **복사 전에** 함께 비운다.
 */
import { sheetCarrySummary } from "@/features/teacher-view/feedback";
import { useSheetLang, useSheetTf, useSheetT } from "@/features/teacher-view/lang-context";
import { useSheetFeedback } from "@/features/teacher-view/lang-context";
import { useMemo, useRef } from "react";
import { toast } from "sonner";
import type { CarryPatch } from "../lib/carry-marks";
import type { PlanPatchField } from "../lib/plan-codec";
import type { PlanLineDTO } from "../server/actions";
import type { PlanWriteApi } from "./plan-api";
import type { ShiftWhich } from "./shift-confirm";
import type { SlotCompareResult } from "@/features/textbooks/server/compare-actions";
import type { SheetSaveStore } from "./use-sheet-saves";

/** 계획 표(PlanTable/PlanRow)가 쓰는 핸들러 — 시트의 넓은 핸들러(SheetHandlers)는 이걸 포함한다. */
export type PlanHandlers = {
  editCell: (lineId: string, field: PlanPatchField, value: string) => void;
  resolveConflict: (saveKey: string, choice: "server" | "mine") => void;
  addLine: (
    planDate: string,
    slotStart: string,
    termMode: "regular" | "exam",
    skillArea: string,
  ) => void;
  copySlot: (planDate: string, slotStart: string, termMode: "regular" | "exam") => void;
  /** 계획 비교(읽기) — 문이 그 기능을 안 내면 **없다**(표가 버튼을 안 그린다). */
  comparePlan?: (planDate: string, slotStart: string) => Promise<SlotCompareResult>;
  /** 회차 미루기·당기기(0282a) — 같은 이유로 선택. `null`이면 표식을 지운다. */
  setShift?: (planDate: string, slotStart: string, kind: "skip" | "advance" | null, which?: ShiftWhich) => void;
  removeLine: (lineId: string, planDate: string, slotStart: string) => void;
  moveLineTerm: (
    lineId: string,
    planDate: string,
    slotStart: string,
    termMode: "regular" | "exam",
  ) => void;
};

/**
 * CAS canonical 시드 — 서버가 준 값이 그 칸의 expected가 된다.
 * 🔴 시드는 **새 줄뿐 아니라 채워진 기존 줄**에도 필요하다(복사는 같은 id의 빈 칸을 UPDATE한다 —
 *    안 심으면 그 칸을 처음 고칠 때 expectedValue가 어긋나 충돌로 뜬다).
 */
export function seedPlanLine(store: SheetSaveStore, l: PlanLineDTO): void {
  store.seed(l.id, "textbook", l.textbook);
  store.seed(l.id, "page_range", l.pageRange);
  store.seed(l.id, "progress", l.progress);
  store.seed(l.id, "homework", l.homework);
  store.seed(l.id, "skill_area", l.skillArea);
}

export function seedPlanLines(store: SheetSaveStore, lines: readonly PlanLineDTO[]): void {
  for (const l of lines) seedPlanLine(store, l);
}

export function usePlanHandlers({
  classId,
  api,
  store,
  onSlotLines,
  onCarried,
  flushHost,
  multiSlot = false,
}: {
  classId: string;
  /** 저장이 나갈 문 — 로그인 `ECS_PLAN_API` / 공개 자리 PIN `seatPlanApi(seat)`. 안정 참조로 넘길 것. */
  api: PlanWriteApi;
  store: SheetSaveStore;
  onSlotLines: (planDate: string, slotStart: string, lines: PlanLineDTO[]) => void;
  onCarried?: (planDate: string, slotStart: string, patches: CarryPatch[]) => void;
  /**
   * 호스트가 **따로** 들고 있는 저장 큐를 함께 비운다 — 내용 복사 전에만 쓴다.
   * 🔴 자리 출석부의 듣기 레벨·누적 암기 단어수는 이 스토어가 아니라 자기 디바운스로 저장된다.
   *    안 비우면 서버가 "빈 칸"으로 보고 지난 값을 채운 뒤, 뒤늦게 도착한 내 입력이 그걸 덮어
   *    **화면(지난 값)과 DB(내 입력)가 갈린다**.
   */
  flushHost?: () => Promise<unknown>;
  /**
   * 이 화면이 **여러 칸**을 그리나(주간 시트) — 그러면 미룸·당김이 돌려준 그 주의 다른 칸도 `onSlotLines`로
   * 갈아 끼운다. 한 칸짜리 화면(`SlotPlanBlock`)은 `onSlotLines`가 날짜·교시를 안 보고 **자기 칸을 통째로**
   * 바꾸므로 절대 넘기지 말 것 — 남의 칸 진도가 이 칸에 그려진다.
   */
  multiSlot?: boolean;
}): PlanHandlers {
  const t = useSheetT();
  const tf = useSheetTf();
  const lang = useSheetLang();
  const feedback = useSheetFeedback();
  // 미룸·당김·되돌리기 연타 막기 — **ref**다. 되돌리기 버튼은 토스트에 10초 살아 있어 옛 memo를 쥐고 있으므로,
  // memo 안 `let`이면 새 memo의 미룸과 옛 memo의 되돌리기가 동시에 돈다(적대적 리뷰 2026-10-19).
  const shiftBusyRef = useRef(false);
  return useMemo(() => {
    /**
     * 미룸·당김·되돌리기 결과를 화면에 — 누른 칸 + 그 주의 다른 바뀐 칸(배정 교재는 요일을 건너 다시 깔린다 —
     * 화를 누르면 그 주 금요일도). 한 칸짜리 화면은 다른 칸을 못 그리니 안내만 한다(`multiSlot` 🔴).
     */
    const applyCells = (
      planDate: string,
      slotStart: string,
      lines: PlanLineDTO[] | undefined,
      cells: { date: string; slotStart: string; lines: PlanLineDTO[] }[] | undefined,
    ) => {
      if (lines) {
        onSlotLines(planDate, slotStart, lines);
        seedPlanLines(store, lines);
      }
      const others = (cells ?? []).filter((c) => !(c.date === planDate && c.slotStart === slotStart));
      if (multiSlot) {
        for (const c of others) {
          onSlotLines(c.date, c.slotStart, c.lines);
          seedPlanLines(store, c.lines);
        }
      } else if (others.length > 0) {
        toast.info(t("plan.feedback.shiftOtherCells"));
      }
    };
    return {
      editCell: (lineId, field, value) => store.edit(lineId, field, value),
      resolveConflict: (saveKey, choice) => store.resolveConflict(saveKey, choice),
      addLine: (planDate, slotStart, termMode, skillArea) => {
        void api.createLine({ classId, planDate, slotStart }, { termMode, skillArea }).then((r) => {
          if (!r.ok) return toast.error(feedback(r.error));
          onSlotLines(planDate, slotStart, r.lines);
          seedPlanLines(store, r.lines);
        });
      },
      // 내용 복사(같은 교시의 지난 수업 → 빈 칸만) — 서버가 canonical 행을 돌려주므로 addLine과 **같은
      // 방식**으로 state를 갈아끼우고 CAS 시드도 다시 심는다.
      copySlot: (planDate, slotStart, termMode) => {
        // ⚠️ **반영 전 flush 필수** — 복사가 대상 행을 갱신하므로, 아직 확정 안 된 셀 입력(디바운스 800ms)이
        //    큐에 남아 있으면 서버 값과 순서가 뒤집혀 방금 친 글자가 되돌아간다('시트 가져오기'와 같은 계약).
        void Promise.all([store.flush(), flushHost?.() ?? Promise.resolve()]).then(([flushed]) => {
          if (!flushed.ok) {
            const go = window.confirm(
              t("today.copy.unsaved"),
            );
            if (!go) return;
          }
          void api.copySlot({ classId, planDate, slotStart }, { termMode }).then((r) => {
            if (!r.ok) return toast.error(feedback(r.error));
            // JJ 이어받기(듣기 레벨·누적 암기 단어수) — 계획 복사와 **따로** 반영한다. 두 칸의 원본은
            // 계획 줄이 아니라 학생 기록이라, 계획이 하나도 안 채워진 경우에도 이 칸은 채워질 수 있다.
            if (r.carried.length > 0) onCarried?.(planDate, slotStart, r.carried);
            if (r.carryError) toast.error(feedback(r.carryError));
            if (r.carryPending) {
              toast.info(t("today.copy.carryPending"));
            }
            // 계획은 채울 게 없었지만 두 칸은 채워진 경우 — "복사할 게 없다"고만 말하면 거짓말이 된다.
            if (r.copied === 0 && r.carrySummary) {
              toast.success(tf("today.copy.carriedOnly", { summary: sheetCarrySummary(lang, r.carrySummary) }));
              return;
            }
            if (r.copied === 0) {
              // 서버가 "왜 아무것도 안 했는지"를 돌려준다 — 조용히 성공한 척하면 사람이 버튼을 계속 누른다.
              // ⚠️ target_not_empty는 0209a 적용 전(옛 함수)에만 온다 — 그때도 raw 코드는 안 보여준다.
              toast.info(
                r.reason === "target_already_filled"
                  ? t("month.importAll.none")
                  : r.reason === "target_not_empty"
                    ? t("today.copy.none.notEmpty")
                    : r.sameDow === true
                      ? t("today.copy.none.sameDow")
                      : t("today.copy.none.any"),
              );
              return;
            }
            onSlotLines(planDate, slotStart, r.lines);
            seedPlanLines(store, r.lines);
            toast.success(
              tf("today.copy.done", { source: r.sourceLabel ? tf("today.copy.done.source", { label: r.sourceLabel }) : "", n: r.copied }) +
                (r.carrySummary ? tf("today.copy.done.carry", { summary: sheetCarrySummary(lang, r.carrySummary) }) : "") +
                (r.truncated > 0 ? tf("today.copy.done.truncated", { n: r.truncated }) : "")
            );
          });
        });
      },
      /**
       * **계획 비교**(원장 2026-09-28) — 읽기만 한다(저장 큐·flush와 무관). 모달이 열릴 때 부른다.
       * ⚠️ 문이 이 기능을 안 내면(공개 자리 PIN) 핸들러 자체가 `undefined`라 표가 버튼을 안 그린다.
       */
      comparePlan: api.comparePlan
        ? (planDate, slotStart) => api.comparePlan!({ classId, planDate, slotStart })
        : undefined,
      /**
       * **회차 미룸·당김**(원장 2026-09-22 → 2026-10-15 *"미루는 거기 복사하고 한주씩 쭉 밀기"*) — 서버가
       * **실제 진도**를 한 칸씩 민다/당긴다 — 배정 교재는 배정한 요일 순서로, 그 밖의 줄은 같은 요일·교시끼리
       * (2026-10-16). 누를 때마다 한 칸(토글 아님).
       * ⚠️ **반영 전 flush 필수** — 옮기기가 그 칸들의 행을 새로 만들므로, 큐에 남은 입력이 있으면 옮겨 가기
       *    전 값이 옮겨지고 뒤늦은 저장은 지워진 행에 부딪힌다(copySlot과 같은 계약).
       * 🔑 누른 칸 + **그 주의 다른 바뀐 칸**(배정 교재가 요일을 건너 다시 깔릴 때)을 즉시 갈아 끼운다(`multiSlot`) —
       *    다른 주는 그 주를 열 때 서버가 준다.
       */
      setShift: api.setShift
        ? (planDate, slotStart, kind, which) => {
            const call = api.setShift;
            if (!call || shiftBusyRef.current) return; // 연타로 두 번 밀리지 않게
            shiftBusyRef.current = true;
            void Promise.all([store.flush(), flushHost?.() ?? Promise.resolve()])
              .then(([flushed]) => {
                if (!flushed.ok && !window.confirm(t("today.copy.unsaved"))) return;
                return call({ classId, planDate, slotStart }, kind, which).then((r) => {
                  if (r.ok) applyCells(planDate, slotStart, r.lines, r.cells);
                  // [되돌리기](원장 2026-10-19 "덮어쓰기(되돌리기)") — 누르기 전 줄을 그대로 돌려놓는다.
                  // 옮기다 멈춘 경우에도 기록이 오면 단다(미룸은 누른 칸을 지우므로 멈춘 채 두면 잃는다).
                  const token = r.undo;
                  const undoCall = api.undoShift;
                  const undo =
                    token && undoCall
                      ? () => {
                          if (shiftBusyRef.current) return;
                          shiftBusyRef.current = true;
                          void Promise.all([store.flush(), flushHost?.() ?? Promise.resolve()])
                            // 히스토리 기록도 함께 '되돌림'으로(툴바 [되돌리기 ▾]에 다시 안 뜨게, 2026-10-26).
                            .then(() => undoCall(classId, token, r.historyId))
                            .then((u) => {
                              if (!u.ok) return void toast.error(feedback(u.error));
                              const pressed = u.cells?.find((c) => c.date === planDate && c.slotStart === slotStart);
                              applyCells(planDate, slotStart, pressed?.lines, u.cells);
                              toast.success(t("plan.shift.undo.done"));
                            })
                            .finally(() => {
                              shiftBusyRef.current = false;
                            });
                        }
                      : null;
                  const undoAction = undo ? { duration: 10_000, action: { label: t("plan.shift.undo"), onClick: undo } } : undefined;
                  if (!r.ok) return void toast.error(feedback(r.error), undoAction);
                  toast.success(
                    kind === null
                      ? t("month.shift.clear.done")
                      : which?.fill
                        ? t("month.shift.fill.done")
                        : r.moved === 0
                          ? t("plan.feedback.shiftMarkOnly")
                          : kind === "skip"
                            ? t("plan.feedback.shiftSkip")
                            : t("plan.feedback.shiftAdvance"),
                    undoAction,
                  );
                });
              })
              .finally(() => {
                shiftBusyRef.current = false;
              });
          }
        : undefined,
      removeLine: (lineId, planDate, slotStart) => {
        void api.deleteLine({ classId, planDate, slotStart }, { lineId }).then((r) => {
          if (!r.ok) return toast.error(feedback(r.error));
          onSlotLines(planDate, slotStart, r.lines);
        });
      },
      moveLineTerm: (lineId, planDate, slotStart, termMode) => {
        void api.moveLine({ classId, planDate, slotStart }, { lineId, termMode, lineNo: 99 }).then((r) => {
          if (!r.ok) return toast.error(feedback(r.error));
          onSlotLines(planDate, slotStart, r.lines);
        });
      },
    };
  }, [api, store, classId, feedback, onSlotLines, flushHost, t, onCarried, tf, lang, multiSlot]);
}
