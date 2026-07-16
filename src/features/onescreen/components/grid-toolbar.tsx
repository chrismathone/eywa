"use client";

import { Button } from "@/components/ui/button";

/** 표 일괄 작업 핸들러 — keys(선택 행) 있으면 그 행만, 없으면 전체. */
export type GridBulkActions = {
  onSaveAll: (keys?: string[]) => void;
  onSendAll: (keys?: string[]) => void;
  onAutoWriteAll: (keys?: string[]) => void; // 선택(또는 전체) 행 자동작성
  onClassNotice?: (keys?: string[]) => void; // 선택(없으면 표시 전체) 학생 학부모 공지 — 진도 무관
};

/** 표 상단 일괄 바 — 카운트·이전 회차 토글·일괄 버튼. (그리드 분해 0단계 이동) */
export function GridToolbar({
  counts,
  selectedKeys,
  prev,
  actions,
  bulkGen,
}: {
  counts: { total: number; eligible: number; selectedEligible: number };
  selectedKeys: string[];
  prev: { has: boolean; show: boolean; onToggle: () => void };
  actions: GridBulkActions;
  bulkGen?: boolean;
}) {
  const { total, eligible, selectedEligible } = counts;
  return (
    <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-2 rounded-md border px-4 py-2.5">
      <span className="text-text-dim text-[12px]">
        표시 <span className="text-foreground font-bold">{total}</span> · 발송가능{" "}
        <span className="text-foreground font-bold">{eligible}</span>
        {selectedKeys.length ? (
          <>
            {" "}
            · 선택 <span className="text-primary font-bold">{selectedKeys.length}</span>
            {selectedKeys.length > selectedEligible ? (
              <span className="text-text-faint"> (발송가능 {selectedEligible})</span>
            ) : null}
          </>
        ) : null}
      </span>
      {prev.has ? (
        <label className="text-text-dim ml-1 flex cursor-pointer items-center gap-1 text-[12px]">
          <input
            type="checkbox"
            checked={prev.show}
            onChange={prev.onToggle}
            className="accent-primary size-3.5"
          />
          이전 회차 참고
        </label>
      ) : null}
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {actions.onClassNotice ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => actions.onClassNotice?.(selectedKeys)}
            title="선택(없으면 표시 전체) 학생 학부모에게 공지 발송 — 진도와 무관"
          >
            {selectedKeys.length ? `선택 ${selectedKeys.length} 공지` : "반 전체 공지"}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => actions.onAutoWriteAll(selectedKeys)}
          disabled={eligible === 0 || bulkGen}
        >
          {bulkGen
            ? "자동작성 중…"
            : selectedKeys.length
              ? `선택 ${selectedEligible} 자동작성`
              : "전체 자동작성"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => actions.onSaveAll(selectedKeys)}
          disabled={eligible === 0 || bulkGen}
        >
          {selectedKeys.length ? `선택 ${selectedEligible} 저장` : "일괄 저장"}
        </Button>
        <Button size="sm" onClick={() => actions.onSendAll(selectedKeys)} disabled={eligible === 0 || bulkGen}>
          {selectedKeys.length ? `선택 ${selectedEligible} 발송` : "ClassNote 일괄 발송"}
        </Button>
      </div>
    </div>
  );
}
