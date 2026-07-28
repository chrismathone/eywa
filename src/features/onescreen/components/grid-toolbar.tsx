"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AttachPicker } from "./grid-attach";
import { bulkPickLabel } from "../bulk-label";
import type { BulkPatch } from "../grid";

/** 표 일괄 작업 핸들러 — keys(선택 행) 있으면 그 행만, 없으면 전체. */
export type GridBulkActions = {
  onSaveAll: (keys?: string[]) => void;
  onSendAll: (keys?: string[]) => void;
  onAutoWriteAll: (keys?: string[]) => void; // 선택(또는 전체) 행 자동작성
  onClassNotice?: (keys?: string[]) => void; // 선택(없으면 표시 전체) 학생 학부모 공지 — 진도 무관
  // 값 일괄 적용(1-2) — 진도 필터 없는 raw 행 대상. progressSubjectKey = 진도를 넣을 과목(그 과목 행에만).
  onBulkApply: (keys: string[], patch: BulkPatch, onlyEmpty: boolean, progressSubjectKey: string) => void;
  // 맨 위 행의 수업 내용(진도·교재·오늘 과제)을 아래 행에 복사 — 같은 진도를 학생마다 다시 고르지 않게.
  onCopyFirstRow?: (keys: string[], overwrite: boolean) => void;
  // 이전 회차 일괄 가져오기(G5 얕은판) — 선택(없으면 표시 전체) 행의 **빈 칸만** planPrevFill로 채움(특이사항·교재 제외).
  onBulkImportPrev?: (keys?: string[]) => void;
  // 선택 행 일괄 첨부 — 같은 시험지·판서 사진을 여러 학생에게 한 번에. **선택이 있을 때만** 노출(전체 대상 오첨부 방지).
  onBulkAttach?: (keys: string[], files: File[]) => void;
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
    // 자동작성 실대상 = 발송가능 − 이미 멘트가 있는 행(보존 대상). 버튼 라벨·비활성 판정에 그대로 쓴다.
    autoWritable: number;
    selectedAutoWritable: number;
  };
  selectedKeys: string[];
  prev: { has: boolean; show: boolean; onToggle: () => void };
  actions: GridBulkActions;
  bulkGen?: boolean;
  locked?: boolean; // 순서 모드 중 — 선택이 ↑↓로 가려져 있어 일괄 액션 버튼을 잠근다(#24)
  navHint?: boolean; // 점수·교재 칸 Enter/↑↓ 세로 이동 힌트 노출(#21)
  children?: ReactNode;
}) {
  const { total, sendable, saveable, selectedSendable, selectedSaveable, autoWritable, selectedAutoWritable } =
    counts;
  const genTarget = selectedKeys.length ? selectedAutoWritable : autoWritable; // 실제로 생성될 행 수
  const genPreserved = (selectedKeys.length ? selectedSendable : sendable) - genTarget; // 멘트 있어 건너뛸 행 수
  const off = bulkGen || locked;
  const noticeStudents = new Set(selectedKeys.map((k) => k.split("::")[0])).size; // 공지=학생 단위(행 아님, #23)
  return (
    <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-2.5">
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
        {/* G5 얕은판 — 이전 회차 값으로 빈 칸 일괄 채우기. 값 일괄(팝오버=children) 옆이 자연 위치.
            기존값은 절대 안 덮음(planPrevFill=빈 칸만)이라 confirm 불필요. 진도 게이트 무관(raw 행 대상). */}
        {actions.onBulkImportPrev ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => actions.onBulkImportPrev?.(selectedKeys.length ? selectedKeys : undefined)}
            disabled={off}
            title="선택(없으면 표시 전체) 행의 빈 칸을 이전 회차 값으로 채웁니다 — 진도·태도·과제·오늘 과제만, 특이사항 제외. 멘트는 확인을 받은 뒤에만. 이미 입력한 칸은 건드리지 않습니다"
          >
            {/* 행별 버튼과 같은 말로 통일 — '채우기'/'가져오기' 혼용 금지(원장 지시 07-21). */}
            {selectedKeys.length ? `선택 ${selectedKeys.length} 이전값 가져오기` : "이전값 일괄 가져오기"}
          </Button>
        ) : null}
        {/* 일괄 첨부 — 파일을 고르는 즉시 선택 행에 첨부된다(확인 다이얼로그 없음: 첨부는 되돌리기가 쉬운 편이고
            대상이 '선택 행'으로 이미 좁혀져 있다). 선택이 없으면 대상이 모호해 아예 안 보인다. */}
        {actions.onBulkAttach && selectedKeys.length > 0 ? (
          <AttachPicker
            disabled={off}
            onFiles={(files) => actions.onBulkAttach?.(selectedKeys, files)}
          >
            {`선택 ${selectedKeys.length} 첨부`}
          </AttachPicker>
        ) : null}
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
        {/* 자동작성 = **멘트 없는 행만**. 이전값 가져오기로 멘트를 깔면 대상이 줄어드는 게 라벨에 바로 보이고,
            0이 되면 비활성 — "채운 문구를 재생성이 덮어쓰나?"를 화면에서 답해준다(보존 로직은 autoWriteAllVisible). */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => actions.onAutoWriteAll(selectedKeys)}
          disabled={genTarget === 0 || off}
          title={
            genTarget === 0
              ? genPreserved > 0
                ? `자동작성할 행이 없습니다 — 멘트가 있는 ${genPreserved}건은 그대로 둡니다(다시 만들려면 행별 '자동작성')`
                : "자동작성할 행이 없습니다 — 오늘 진도를 먼저 입력하세요"
              : genPreserved > 0
                ? `멘트가 비어 있는 ${genTarget}건만 생성합니다 — 이미 멘트가 있는 ${genPreserved}건은 건드리지 않습니다`
                : `${genTarget}건의 멘트를 생성합니다`
          }
        >
          {bulkGen
            ? "자동작성 중…"
            : selectedKeys.length
              ? `${bulkPickLabel(selectedKeys.length, genTarget)} 자동작성`
              : `전체 자동작성 ${genTarget}`}
        </Button>
        {/* ⚠️ disabled는 **선택이 있으면 선택분 기준**이다(2026-07-21 수정). 예전엔 전체 `saveable`만 봐서,
            고른 37행이 전부 저장 대상이 아닌데도 버튼이 살아 있어 눌러도 아무 일이 없었다. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => actions.onSaveAll(selectedKeys)}
          disabled={(selectedKeys.length ? selectedSaveable : saveable) === 0 || off}
          title={
            selectedKeys.length && selectedSaveable === 0
              ? "고른 행 중 저장할 수 있는 행이 없습니다 — 오늘 진도가 비었거나 이미 발송된 행입니다"
              : undefined
          }
        >
          {selectedKeys.length ? `${bulkPickLabel(selectedKeys.length, selectedSaveable)} 저장` : "일괄 저장"}
        </Button>
        <Button
          size="sm"
          onClick={() => actions.onSendAll(selectedKeys)}
          disabled={(selectedKeys.length ? selectedSendable : sendable) === 0 || off}
          title={
            selectedKeys.length && selectedSendable === 0
              ? "고른 행 중 발송할 수 있는 행이 없습니다 — 결석·과목 제외·이미 발송된 행입니다"
              : undefined
          }
        >
          {selectedKeys.length ? `${bulkPickLabel(selectedKeys.length, selectedSendable)} 발송` : "ClassNote 일괄 발송"}
        </Button>
      </div>
    </div>
  );
}
