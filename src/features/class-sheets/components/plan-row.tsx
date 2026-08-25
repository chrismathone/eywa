"use client";

// 계획 1행 — 영역 셀렉트(CAS patch) + 텍스트 4칸(디바운스 CAS) + 시기 이동 + 삭제.
// 충돌 시 그 셀만 pause + "서버값/내 값" 인라인 선택(계획 v2.2 §C — 자동 덮어쓰기 금지).
import { memo } from "react";
import { X } from "@/components/icons/eywa-icon-compat";
import { skillAreaColorOf, skillAreaLabelOf } from "@/features/owner/skill-areas";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { buildSaveKey } from "../lib/save-keys";
import type { PlanPatchField } from "../lib/plan-codec";
import type { PlanLineDTO } from "../server/actions";
import { SHEET_BOX_FRAME, SHEET_INPUT } from "../ui-box";
import type { PlanHandlers } from "./use-plan-handlers";
import { useCellState, type SheetSaveStore } from "./use-sheet-saves";

function CasInput({
  lineId,
  field,
  fallback,
  store,
  handlers,
  canEdit,
  ariaLabel,
}: {
  lineId: string;
  field: PlanPatchField;
  fallback: string | null;
  store: SheetSaveStore;
  handlers: PlanHandlers;
  canEdit: boolean;
  ariaLabel: string;
}) {
  const saveKey = buildSaveKey(lineId, field);
  const cell = useCellState(store, saveKey);
  const value = cell ? (cell.value ?? "") : (fallback ?? "");
  if (cell?.conflict) {
    return (
      <div className="border-danger bg-danger/5 space-y-1 rounded-md border px-1.5 py-1">
        <p className="text-danger text-[11px] leading-tight">
          다른 강사가 수정: <b>{cell.conflict.serverValue ?? "(비움)"}</b>
        </p>
        <p className="text-text-dim truncate text-[11px]">내 입력: {value || "(비움)"}</p>
        <div className="flex gap-1">
          <button
            type="button"
            className="border-line-strong text-foreground cursor-pointer rounded-full border px-1.5 text-[11px] font-semibold"
            onClick={() => handlers.resolveConflict(saveKey, "server")}
          >
            서버값 사용
          </button>
          <button
            type="button"
            className="border-danger text-danger cursor-pointer rounded-full border px-1.5 text-[11px] font-medium"
            onClick={() => handlers.resolveConflict(saveKey, "mine")}
          >
            내 값으로 덮기
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
      onChange={(e) => handlers.editCell(lineId, field, e.target.value)}
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
  const areaCls = `${SHEET_BOX_FRAME} w-full cursor-pointer px-1 text-[13px] font-bold outline-none focus:border-primary ${SUBJECT_SOFT[areaTone]}`;

  return (
    <tr className="align-top">
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
            className={`${SHEET_BOX_FRAME} inline-flex w-full items-center justify-center truncate px-1 text-[13px] font-bold ${SUBJECT_SOFT[areaTone]}`}
          >
            {areaLabel}
          </span>
        )}
      </td>
      <td className="py-0.5 pr-1">
        <CasInput lineId={line.id} field="textbook" fallback={line.textbook} store={store} handlers={handlers} canEdit={canEdit} ariaLabel="교재" />
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
