"use client";

// 계획 1행 — 영역 셀렉트(CAS patch) + 텍스트 4칸(디바운스 CAS) + 시기 이동 + 삭제.
// 충돌 시 그 셀만 pause + "서버값/내 값" 인라인 선택(계획 v2.2 §C — 자동 덮어쓰기 금지).
import { memo, useCallback } from "react";
import { X } from "@/components/icons/aywa-icon-compat";
import { skillAreaColorOf, skillAreaLabelOf } from "@/features/owner/skill-areas";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { buildSaveKey } from "../lib/save-keys";
import type { PlanPatchField } from "../lib/plan-codec";
import type { PlanLineDTO } from "../server/actions";
import { SHEET_BOX_FRAME, SHEET_INPUT } from "../ui-box";
import type { PlanHandlers } from "./use-plan-handlers";
import { useCellState, type SheetSaveStore } from "./use-sheet-saves";
// 충돌 문구는 오늘 면 계획(`today-plan-editor.tsx`)과 **같은 사전 키**를 쓴다 — 같은 UI가 두 벌이라
// 한쪽만 옮기면 같은 다이얼로그가 화면마다 다른 언어로 뜬다.
import { useSheetT } from "@/features/teacher-view/lang-context";
import { useTextbookOptions } from "@/features/textbooks/textbook-options-context";

function CasInput({
  lineId,
  field,
  fallback,
  store,
  handlers,
  canEdit,
  ariaLabel,
  listId,
  onCommit,
}: {
  lineId: string;
  field: PlanPatchField;
  fallback: string | null;
  store: SheetSaveStore;
  handlers: PlanHandlers;
  canEdit: boolean;
  ariaLabel: string;
  /** `<datalist>` id — 교재 칸만 준다(없으면 속성을 아예 안 단다). */
  listId?: string | null;
  /** 칸을 떠날 때 그 시점 값으로 한 번 불린다 — 교재 칸이 페이지/시간을 채우는 자리. */
  onCommit?: (value: string) => void;
}) {
  const t = useSheetT();
  const saveKey = buildSaveKey(lineId, field);
  const cell = useCellState(store, saveKey);
  const value = cell ? (cell.value ?? "") : (fallback ?? "");
  if (cell?.conflict) {
    return (
      <div className="border-danger bg-danger/5 space-y-1 rounded-md border px-1.5 py-1">
        <p className="text-danger text-xs leading-tight">
          {t("cell.conflict.server")} <b>{cell.conflict.serverValue ?? t("cell.conflict.empty")}</b>
        </p>
        <p className="text-text-dim truncate text-xs">
          {t("cell.conflict.mine")} {value || t("cell.conflict.empty")}
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            className="border-line-strong text-foreground cursor-pointer rounded-full border px-1.5 text-xs font-semibold"
            onClick={() => handlers.resolveConflict(saveKey, "server")}
          >
            {t("cell.conflict.useServer")}
          </button>
          <button
            type="button"
            className="border-danger text-danger cursor-pointer rounded-full border px-1.5 text-xs font-medium"
            onClick={() => handlers.resolveConflict(saveKey, "mine")}
          >
            {t("cell.conflict.useMine")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <input
      className={SHEET_INPUT}
      value={value}
      disabled={!canEdit}
      aria-label={ariaLabel}
      list={listId ?? undefined}
      onChange={(e) => handlers.editCell(lineId, field, e.target.value)}
      onBlur={onCommit ? (e) => onCommit(e.target.value) : undefined}
    />
  );
}

/**
 * 교재 칸 — 제안 목록(교재목록 마스터, 0266a) + 고르면 **빈** 페이지/시간 칸만 채운다.
 *
 * 🔴 **컴포넌트로 떼어 낸 이유**: 페이지/시간 셀 상태를 `PlanRow` 본체에서 구독하면 그 칸에 한 글자
 *    칠 때마다 `memo`된 **행 전체**가 다시 그려진다(원래는 그 `CasInput`만 그렸다). 오늘 면
 *    (`today-plan-editor.tsx`)이 같은 이유로 같은 모양을 쓴다.
 * 🔴 **이미 적힌 값은 절대 안 덮는다**(ECS 전역 규약 — `ecs_copy_slot`의 "빈 칸만 채우기"와 같다).
 *    실측(2026-09-16, 채워진 1,368칸 중 816칸)에서 이 칸은 `35분`·`15분`처럼 교재마다 사실상 고정값이라
 *    매번 손으로 치던 자리다.
 * 🔴 **구분(skill_area)은 자동으로 안 바꾼다** — 실측상 교재 372종 중 28종이 둘 이상의 구분에서 쓰인다
 *    (`인재원 SRS` = vocab·writing·listening). 자동으로 바꾸면 사람이 골라 둔 구분을 되돌린다.
 * ⚠️ 프로바이더 밖(공개 PIN 자리 화면)이면 목록이 비어 `<datalist>`도, 자동 채움도 없다(그대로 자유 입력).
 */
function BookCasInput({
  lineId,
  fallback,
  pageRangeFallback,
  store,
  handlers,
  canEdit,
}: {
  lineId: string;
  fallback: string | null;
  pageRangeFallback: string | null;
  store: SheetSaveStore;
  handlers: PlanHandlers;
  canEdit: boolean;
}) {
  const { options, listId } = useTextbookOptions();
  const pageCell = useCellState(store, buildSaveKey(lineId, "page_range"));
  const pageValue = pageCell ? (pageCell.value ?? "") : (pageRangeFallback ?? "");
  const onCommit = useCallback(
    (raw: string) => {
      if (!canEdit) return;
      if (pageValue.trim() !== "") return; // 이미 적힌 칸은 그대로
      const typed = raw.trim().toLowerCase();
      if (!typed) return;
      const hit = options.find((o) => o.title.trim().toLowerCase() === typed);
      const pageTime = hit?.pageTime?.trim();
      if (!pageTime) return;
      handlers.editCell(lineId, "page_range", pageTime);
    },
    [canEdit, pageValue, options, handlers, lineId],
  );
  return (
    <CasInput
      lineId={lineId}
      field="textbook"
      fallback={fallback}
      store={store}
      handlers={handlers}
      canEdit={canEdit}
      ariaLabel="교재"
      listId={listId}
      onCommit={onCommit}
    />
  );
}

export const PlanRow = memo(function PlanRow({
  line,
  date,
  slotStart,
  skillAreas,
  store,
  handlers,
  canEdit,
}: {
  line: PlanLineDTO;
  date: string;
  slotStart: string;
  skillAreas: SkillAreaSetting[];
  store: SheetSaveStore;
  handlers: PlanHandlers;
  canEdit: boolean;
}) {
  const areaKey = buildSaveKey(line.id, "skill_area");
  const areaCell = useCellState(store, areaKey);
  const areaValue = areaCell?.value ?? line.skillArea;

  const { label: areaLabel, known } = skillAreaLabelOf(skillAreas, areaValue ?? "");
  // 영역 고유색 — 계획 표에서도 패널과 **같은 색**이라 "보카 줄"을 색으로 찾는다(단일 소스: 학원설정).
  const areaTone = skillAreaColorOf(skillAreas, areaValue ?? "");
  // 셀렉트도 알약처럼 — 닫힌 상태(평소 보이는 모습)에 색·굵기가 그대로 실린다.
  // 치수는 시트 공통 박스(SHEET_BOX_FRAME = h-5·rounded-sm)를 그대로 쓴다 — 여기만 h-6으로 두면
  // 같은 줄의 교재·시간 칸과 높이가 어긋난다(높이를 덧붙여 덮지 말 것: 이기는 쪽은 CSS 순서가 정한다).
  const areaCls = `${SHEET_BOX_FRAME} w-full cursor-pointer px-1 text-sm font-bold outline-none focus:border-primary ${SUBJECT_SOFT[areaTone]}`;

  return (
    <tr className="align-top" data-skill-area={areaValue ?? undefined}>
      <td className="py-0.5 pr-1">
        {canEdit ? (
          <select
            className={areaCls}
            value={known ? (areaValue ?? "") : ""}
            aria-label="구분(영역)"
            onChange={(e) => {
              if (e.target.value) handlers.editCell(line.id, "skill_area", e.target.value);
            }}
          >
            {!known ? <option value="">{areaLabel} (미등록)</option> : null}
            {skillAreas.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        ) : (
          <span
            className={`${SHEET_BOX_FRAME} inline-flex w-full items-center justify-center truncate px-1 text-sm font-bold ${SUBJECT_SOFT[areaTone]}`}
          >
            {areaLabel}
          </span>
        )}
      </td>
      <td className="py-0.5 pr-1">
        <BookCasInput
          lineId={line.id}
          fallback={line.textbook}
          pageRangeFallback={line.pageRange}
          store={store}
          handlers={handlers}
          canEdit={canEdit}
        />
      </td>
      <td className="py-0.5 pr-1">
        <CasInput lineId={line.id} field="page_range" fallback={line.pageRange} store={store} handlers={handlers} canEdit={canEdit} ariaLabel="페이지/시간" />
      </td>
      <td className="py-0.5 pr-1">
        <CasInput lineId={line.id} field="progress" fallback={line.progress} store={store} handlers={handlers} canEdit={canEdit} ariaLabel="진도" />
      </td>
      <td className="py-0.5 pr-1">
        <CasInput lineId={line.id} field="homework" fallback={line.homework} store={store} handlers={handlers} canEdit={canEdit} ariaLabel="과제" />
      </td>
      <td className="py-0.5">
        {canEdit ? (
          <button
            type="button"
            aria-label="줄 삭제"
            className="text-text-dim hover:text-danger cursor-pointer rounded p-0.5"
            onClick={() => {
              const hasContent = [line.textbook, line.pageRange, line.progress, line.homework].some(
                (v) => (v ?? "").trim() !== "",
              );
              if (hasContent && !window.confirm("내용이 있는 줄입니다. 삭제할까요?")) return;
              handlers.removeLine(line.id, date, slotStart);
            }}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </td>
    </tr>
  );
});
