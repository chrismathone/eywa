"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HomeworkVideoPlayer } from "@/features/students/components/homework-video-player";
import type { VideoArrival } from "../types";
import type { ActiveCell } from "./round-editor";

/** 장부 안에서 재생한다. 닫으면 iframe을 제거해 소리도 멈추며 학생 상세로 이동하지 않는다. */
export function LedgerVideoDialog({ cell, video, onClose }: { cell: ActiveCell | null; video: VideoArrival | null; onClose: () => void }) {
  const title = cell ? `${cell.row.studentName} · 숙제 영상 ${cell.number}회` : "숙제 영상";
  const playback = video?.playback;
  return <Dialog open={cell !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{cell ? `${cell.row.className} · 숙제 ${cell.round.homeworkDate ?? cell.round.date}` : "숙제 영상을 확인합니다."}</DialogDescription>
      </DialogHeader>
      {cell ? playback ? <HomeworkVideoPlayer key={video?.id} preview={playback.preview} thumbnail={playback.thumbnail}
        uploadedAt={playback.uploadedAt} title={title} />
        : <p role="status" className="text-text-dim p-6 text-center text-sm">아직 재생할 수 없는 영상입니다. 잠시 뒤 다시 확인해 주세요.</p> : null}
    </DialogContent>
  </Dialog>;
}
