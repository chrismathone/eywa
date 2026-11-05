"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { usePrintWindow } from "@/components/workspace/print-window";
import { MeetingDeleteConfirm, MeetingRetryButton } from "./meeting-actions";
import { downloadMeetingTxt, type MeetingTxtSource } from "./meeting-txt";

/**
 * 회의록 상세 머리의 **텍스트 Secondary 하나** — '더보기'(인쇄 미리보기 · 텍스트 저장 · 전사부터 다시 · 삭제).
 * 지시서 §10: 상시 버튼은 창당 둘까지(Primary 'AI로 정리' + 이것). 옛 머리엔 버튼이 다섯(인쇄·TXT·AI·전사·삭제) 섰다.
 * 학생목록 '엑셀' 메뉴와 같은 모양(읽히는 글자 + 꺾쇠, 아이콘 온리 `⋮` 아님).
 *
 * 돈이 들거나 되돌릴 수 없는 항목(전사부터 다시 = AssemblyAI 재제출 · 삭제)은 고르면 **그 자리에서 한 번 더 확인**한다 —
 * 옛 삭제 버튼의 2단계 확인을 그대로 잇는다(메뉴 항목 하나로 바로 실행하지 않는다).
 */
export function MeetingMoreMenu({
  meetingId,
  printHref,
  canPrint,
  txt,
  canRetry,
  canDelete,
}: {
  meetingId: string;
  printHref: string;
  /** AI 리포트가 있을 때만(인쇄물이 리포트다). */
  canPrint: boolean;
  /** 내려받을 내용(리포트·메모·전사 중 하나라도)이 있을 때만. null이면 항목이 없다. */
  txt: MeetingTxtSource | null;
  /** 원본 오디오가 있고 처리 중이 아니고 **쓰기 권한**이 있을 때만(페이지가 함께 판정). */
  canRetry: boolean;
  /** 쓰기 권한(deleteMeeting과 같은 canWriteTenant("meetings")) — 거짓이면 '삭제' 항목이 없다. */
  canDelete: boolean;
}) {
  const [mode, setMode] = useState<null | "delete" | "retry">(null);
  const openPrint = usePrintWindow();

  if (mode === "delete" && canDelete) return <MeetingDeleteConfirm meetingId={meetingId} onCancel={() => setMode(null)} />;
  // 읽기 권한에 인쇄·텍스트 저장도 없으면(내용 없는 회의록) 열 메뉴가 비므로 '더보기' 자체를 그리지 않는다.
  if (!canPrint && !txt && !canRetry && !canDelete) return null;
  // 🔴 `canRetry`를 함께 본다 — 확인 버튼을 누르면 액션이 상태를 `transcribing`으로 쓰고 서버가 canRetry=false를 내려보내지만
  //    클라 state `mode`는 남아, 확인 줄이 그대로 서 있으면 "됐나?" 하고 한 번 더 눌러 AssemblyAI에 **이중 제출**된다
  //    (첫 작업의 웹훅은 transcript id가 덮여 버려진다 — 리뷰 확정 결함). 부모도 `key={processingStatus}`로 state를 리셋한다.
  if (mode === "retry" && canRetry) {
    return (
      <div className="flex items-center gap-2">
        {/* 라벨은 메뉴 항목과 달리 **확인**으로 읽히게('삭제 확인'과 같은 결). */}
        <MeetingRetryButton meetingId={meetingId} label="재전사 확인" variant="outline" outerClassName="" />
        <button
          type="button"
          onClick={() => setMode(null)}
          className={`${CONTROL_H} ${CONTROL_LABEL} text-text-faint hover:text-foreground inline-flex items-center px-1 whitespace-nowrap transition`}
        >
          취소
        </button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={`${CONTROL_H} ${CONTROL_LABEL} text-primary hover:bg-bg-soft inline-flex items-center gap-0.5 rounded-md px-1.5 font-medium whitespace-nowrap transition`}
          />
        }
      >
        더보기
        {/* 아이콘은 라벨(18px)과 같은 크기(±10%). */}
        <EyIcon name="chevronDown" size={18} className="opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {canPrint ? (
          <DropdownMenuItem
            onClick={(e) => openPrint({ id: `print/meetings/${meetingId}`, href: printHref, title: "회의록" }, e)}
          >
            인쇄 미리보기
          </DropdownMenuItem>
        ) : null}
        {txt ? <DropdownMenuItem onClick={() => downloadMeetingTxt(txt)}>텍스트 저장</DropdownMenuItem> : null}
        {canRetry ? <DropdownMenuItem onClick={() => setMode("retry")}>전사부터 다시</DropdownMenuItem> : null}
        {canDelete ? (
          <>
            {canPrint || txt || canRetry ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem variant="destructive" onClick={() => setMode("delete")}>
              삭제
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
