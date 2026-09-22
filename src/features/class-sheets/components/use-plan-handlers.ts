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
import { useMemo } from "react";
import { toast } from "sonner";
import type { CarryPatch } from "../lib/carry-marks";
import type { PlanPatchField } from "../lib/plan-codec";
import type { PlanLineDTO } from "../server/actions";
import type { PlanWriteApi } from "./plan-api";
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
  /** 월간계획 가져오기 — 문이 그 기능을 안 내면 **없다**(표가 버튼을 안 그린다). */
  importPlan?: (planDate: string, slotStart: string) => void;
  /** 회차 미루기·당기기(0282a) — 같은 이유로 선택. `null`이면 표식을 지운다. */
  setShift?: (planDate: string, slotStart: string, kind: "skip" | "advance" | null) => void;
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
}): PlanHandlers {
  return useMemo(
    () => ({
      editCell: (lineId, field, value) => store.edit(lineId, field, value),
      resolveConflict: (saveKey, choice) => store.resolveConflict(saveKey, choice),
      addLine: (planDate, slotStart, termMode, skillArea) => {
        void api.createLine({ classId, planDate, slotStart }, { termMode, skillArea }).then((r) => {
          if (!r.ok) return toast.error(r.error);
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
              "아직 저장이 확정되지 않은 입력(또는 충돌)이 있습니다. 그래도 지난 수업 내용을 복사할까요? (입력을 잃을 수 있습니다)",
            );
            if (!go) return;
          }
          void api.copySlot({ classId, planDate, slotStart }, { termMode }).then((r) => {
            if (!r.ok) return toast.error(r.error);
            // JJ 이어받기(듣기 레벨·누적 암기 단어수) — 계획 복사와 **따로** 반영한다. 두 칸의 원본은
            // 계획 줄이 아니라 학생 기록이라, 계획이 하나도 안 채워진 경우에도 이 칸은 채워질 수 있다.
            if (r.carried.length > 0) onCarried?.(planDate, slotStart, r.carried);
            if (r.carryError) toast.error(r.carryError);
            if (r.carryPending) {
              toast.info("듣기 레벨·누적 암기 단어수 칸은 아직 준비 중입니다(관리자에게 문의하세요)");
            }
            // 계획은 채울 게 없었지만 두 칸은 채워진 경우 — "복사할 게 없다"고만 말하면 거짓말이 된다.
            if (r.copied === 0 && r.carrySummary) {
              toast.success(`${r.carrySummary} 채움 — 지난 기록 값이라 바뀐 학생은 고쳐 주세요`);
              return;
            }
            if (r.copied === 0) {
              // 서버가 "왜 아무것도 안 했는지"를 돌려준다 — 조용히 성공한 척하면 사람이 버튼을 계속 누른다.
              // ⚠️ target_not_empty는 0209a 적용 전(옛 함수)에만 온다 — 그때도 raw 코드는 안 보여준다.
              toast.info(
                r.reason === "target_already_filled"
                  ? "빈 칸이 없어 채울 게 없습니다(이미 쓴 칸은 덮어쓰지 않습니다)"
                  : r.reason === "target_not_empty"
                    ? "이미 계획이 있는 교시라 복사하지 않았습니다(덮어쓰기 없음)"
                    : r.sameDow === true
                      ? "복사할 지난 같은 요일 수업이 없습니다(최근 8주 안에 같은 요일·같은 교시·같은 시기 계획이 없습니다)"
                      : "복사할 지난 수업이 없습니다(최근 8주 안에 같은 교시·같은 시기 계획이 없습니다)",
              );
              return;
            }
            onSlotLines(planDate, slotStart, r.lines);
            seedPlanLines(store, r.lines);
            toast.success(
              (r.sourceLabel ? `${r.sourceLabel} 수업에서 ${r.copied}줄 채움` : `${r.copied}줄 채움`) +
                (r.carrySummary ? ` · ${r.carrySummary} 채움` : "") +
                (r.truncated > 0 ? ` — ${r.truncated}줄은 20줄 상한이라 못 넣었습니다` : ""),
            );
          });
        });
      },
      /**
       * **월간계획 가져오기**(원장 2026-09-22) — 그 칸에 오기로 된 계획을 실제 줄로 옮긴다.
       *
       * 🔑 '내용 복사'와 **같은 계약**이다: ① 반영 전 flush(안 하면 방금 친 글자가 되돌아간다)
       *    ② 서버가 canonical 줄을 돌려주고 ③ 화면이 그걸 그대로 갈아끼우며 CAS 시드도 다시 심는다.
       * ⚠️ 문이 이 기능을 안 내면(공개 자리 PIN) 핸들러 자체가 `undefined`라 표가 버튼을 안 그린다.
       */
      importPlan: api.importPlan
        ? (planDate, slotStart) => {
            const call = api.importPlan;
            if (!call) return;
            void Promise.all([store.flush(), flushHost?.() ?? Promise.resolve()]).then(([flushed]) => {
              if (!flushed.ok) {
                const go = window.confirm(
                  "아직 저장이 확정되지 않은 입력(또는 충돌)이 있습니다. 그래도 월간계획을 가져올까요? (입력을 잃을 수 있습니다)",
                );
                if (!go) return;
              }
              void call({ classId, planDate, slotStart }).then((r) => {
                if (!r.ok) return toast.error(r.error);
                onSlotLines(planDate, slotStart, r.lines);
                seedPlanLines(store, r.lines);
                // 🔴 "가져왔다"고만 말하지 않는다 — 빈 칸이 없어 아무것도 안 바뀐 경우가 흔하다
                //    (덮어쓰기가 없어서 안전한 대신, 조용히 성공한 척하면 사람이 계속 누른다).
                const touched = r.result.added + r.result.filled;
                if (touched === 0) toast.info("빈 칸이 없어 채울 게 없습니다(이미 쓴 칸은 덮어쓰지 않습니다)");
                else toast.success(`월간계획에서 ${touched}칸 채움 — 실제와 다르면 고쳐 주세요`);
              });
            });
          }
        : undefined,
      /**
       * **회차 미루기·당기기**(원장 2026-09-22) — 계획이 파생값이라 표식 한 줄이 앞으로를 통째로 바꾼다.
       * 🔴 **실제 줄은 안 건드린다** — 이미 적은 진도는 그대로다. 그래서 되돌리기도 같은 버튼 한 번이다.
       * ⚠️ 화면 갱신은 서버 액션의 `revalidatePath`가 한다(계획은 서버가 계산해 내려보내는 값이다).
       */
      setShift: api.setShift
        ? (planDate, slotStart, kind) => {
            const call = api.setShift;
            if (!call) return;
            void call({ classId, planDate, slotStart }, kind).then((r) => {
              if (!r.ok) return toast.error(r.error);
              toast.success(
                kind === "skip"
                  ? "이 회차를 미뤘습니다 — 이 칸은 계획 없이 직접 적고, 다음 수업일부터 차수가 이어집니다"
                  : kind === "advance"
                    ? "이 회차를 당겼습니다 — 이 칸엔 다음 차수가 옵니다"
                    : "회차 표식을 지웠습니다 — 원래 차수로 돌아갑니다",
              );
            });
          }
        : undefined,
      removeLine: (lineId, planDate, slotStart) => {
        void api.deleteLine({ classId, planDate, slotStart }, { lineId }).then((r) => {
          if (!r.ok) return toast.error(r.error);
          onSlotLines(planDate, slotStart, r.lines);
        });
      },
      moveLineTerm: (lineId, planDate, slotStart, termMode) => {
        void api.moveLine({ classId, planDate, slotStart }, { lineId, termMode, lineNo: 99 }).then((r) => {
          if (!r.ok) return toast.error(r.error);
          onSlotLines(planDate, slotStart, r.lines);
        });
      },
    }),
    [api, classId, store, onSlotLines, onCarried, flushHost],
  );
}
