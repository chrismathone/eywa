"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { BulkPatch } from "../grid";

/** 표 일괄 작업 핸들러 — keys(선택 행) 있으면 그 행만, 없으면 전체. */
export type GridBulkActions = {
  onSaveAll: (keys?: string[]) => void;
  onSendAll: (keys?: string[]) => void;
  onAutoWriteAll: (keys?: string[]) => void; // 선택(또는 전체) 행 자동작성
  onClassNotice?: (keys?: string[]) => void; // 선택(없으면 표시 전체) 학생 학부모 공지 — 진도 무관
  onBulkApply: (keys: string[], patch: BulkPatch, onlyEmpty: boolean) => void; // 값 일괄 적용(1-2) — 진도 필터 없는 raw 행 대상
};

/** 표 상단 일괄 바 — 카운트·이전 회차 토글·일괄 버튼. children = 버튼 그룹 선두 슬롯(값 일괄 입력 팝오버). */
export function GridToolbar({
  counts,
  selectedKeys,
  prev,
  actions,
  bulkGen,
  locked,
  navHint,
  children,
}: {
  // sendable=진도+결석 제외(발송·자동작성 대상), saveable=진도만(저장 대상 — 결석 포함, 2-3 작업별 분리).
  counts: {
    total: number;
    sendable: number;
    saveable: number;
    selectedSendable: number;
    selectedSaveable: number;
  };
  selectedKeys: string[];
  prev: { has: boolean; show: boolean; onToggle: () => void };
  actions: GridBulkActions;
  bulkGen?: boolean;
  locked?: boolean; // 순서 모드 중 — 선택이 ↑↓로 가려져 있어 일괄 액션 버튼을 잠근다(#24)
  navHint?: boolean; // 점수·교재 칸 Enter/↑↓ 세로 이동 힌트 노출(#21)
  children?: ReactNode;
}) {
  const { total, sendable, saveable, selectedSendable, selectedSaveable } = counts;
  const off = bulkGen || locked;
  const noticeStudents = new Set(selectedKeys.map((k) => k.split("::")[0])).size; // 공지=학생 단위(행 아님, #23)
  return (
    <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-2 rounded-md border px-4 py-2.5">
      <span className="text-text-dim text-[12px]">
        표시 <span className="text-foreground font-bold">{total}</span> · 발송가능{" "}
        <span className="text-foreground font-bold">{sendable}</span>
        {selectedKeys.length ? (
          <>
            {" "}
            · 선택 <span className="text-primary font-bold">{selectedKeys.length}</span>
            {selectedKeys.length > selectedSendable ? (
              <span className="text-text-faint"> (발송가능 {selectedSendable})</span>
            ) : null}
          </>
        ) : null}
      </span>
      {navHint ? (
        <span className="text-text-faint hidden text-[11px] lg:inline">· 점수·교재 칸은 Enter·↑↓로 위·아래 이동</span>
      ) : null}
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
        {children}
        {actions.onClassNotice ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => actions.onClassNotice?.(selectedKeys)}
            disabled={off}
            title="선택(없으면 표시 전체) 학생 학부모에게 공지 발송 — 진도와 무관"
          >
            {noticeStudents ? `선택 ${noticeStudents}명 공지` : "반 전체 공지"}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => actions.onAutoWriteAll(selectedKeys)}
          disabled={sendable === 0 || off}
        >
          {bulkGen
            ? "자동작성 중…"
            : selectedKeys.length
              ? `선택 ${selectedSendable} 자동작성`
              : "전체 자동작성"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => actions.onSaveAll(selectedKeys)}
          disabled={saveable === 0 || off}
        >
          {selectedKeys.length ? `선택 ${selectedSaveable} 저장` : "일괄 저장"}
        </Button>
        <Button size="sm" onClick={() => actions.onSendAll(selectedKeys)} disabled={sendable === 0 || off}>
          {selectedKeys.length ? `선택 ${selectedSendable} 발송` : "ClassNote 일괄 발송"}
        </Button>
      </div>
    </div>
  );
}
