"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HomeworkVideoPlayer } from "@/features/students/components/homework-video-player";
import { AiReviewPanel } from "@/features/video-review/components/ai-review-panel";
import type { VideoArrival } from "../types";
import type { ActiveCell } from "./round-editor";

/** 장부 안에서 재생한다. 닫으면 재생기를 제거해 소리도 멈추며 학생 상세로 이동하지 않는다. */
export function LedgerVideoDialog({ cell, video, onClose }: { cell: ActiveCell | null; video: VideoArrival | null; onClose: () => void }) {
  const title = cell ? `${cell.row.studentName} · 숙제 영상 ${cell.number}회` : "숙제 영상";
  const playback = video?.playback;
  return <Dialog open={cell !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-3xl lg:max-w-6xl">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{cell ? `${cell.row.className} · 숙제 ${cell.round.homeworkDate ?? cell.round.date}` : "숙제 영상을 확인합니다."}</DialogDescription>
      </DialogHeader>
      {/* 넓은 화면은 영상 | AI 참고 메모 좌우(원장 2026-10-21 "영상과 분석을 좌우로") · 좁으면 위아래 · 메모가 없으면(기능 꺼짐) 영상만 꽉 차게 */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 lg:flex-1">
          {cell ? playback ? <HomeworkVideoPlayer key={video?.id} videoId={video?.id} preview={playback.preview} thumbnail={playback.thumbnail}
            uploadedAt={playback.uploadedAt} title={title} />
            : <p role="status" className="text-text-dim p-6 text-center text-sm">아직 재생할 수 없는 영상입니다. 잠시 뒤 다시 확인해 주세요.</p> : null}
        </div>
        {cell && video?.id ? <AiReviewPanel key={video.id} videoId={video.id} /> : null}
      </div>
    </DialogContent>
  </Dialog>;
}
