"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HomeworkVideoPlayer } from "@/features/students/components/homework-video-player";
import { AiReviewPanel } from "@/features/video-review/components/ai-review-panel";
import { kstDateOf } from "@/lib/date-kst";
import type { VideoArrival } from "../types";
import type { ActiveCell } from "./round-editor";

/**
 * 장부 안에서 재생한다. 닫으면 재생기를 제거해 소리도 멈추며 학생 상세로 이동하지 않는다.
 * `videos` = 그 칸에 보이는 영상(게시 순 — `LedgerRound.videoIds`). 여럿이면(한 숙제에 여러 단원 — 원장 2026-10-21) 위에서 하나씩 고른다.
 * 넓은 화면은 영상 | AI 참고 메모 좌우(원장 2026-10-21 "영상과 분석을 좌우로") — 🔴 창 크기는 **영상**이 정한다(원장 2026-10-21 "메모크기에 맞추지말고
 * 영상크기에 맞추고 메모는 스크롤 · 영상이 작아질 필요는 없음"): 영상 칸 폭 = 70rem · 화면 높이에 다 보이는 폭 · 메모 칸을 뺀 화면 폭 중 가장 작은 값,
 * 메모 칸은 영상 칸 높이에 맞춰 안에서 스크롤(ai-review-panel). 좁으면 위아래. 메모가 없으면(기능 꺼짐·수학 아님) 영상만.
 */
export function LedgerVideoDialog({ cell, videos, onClose }: { cell: ActiveCell | null; videos: readonly VideoArrival[]; onClose: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const title = cell ? `${cell.row.studentName} · 숙제 영상 ${cell.number}회` : "숙제 영상";
  const video = videos.find((v) => v.id === picked) ?? videos[0] ?? null;
  const playback = video?.playback;
  return <Dialog open={cell !== null} onOpenChange={(open) => { if (!open) { setPicked(null); onClose(); } }}>
    <DialogContent className="sm:max-w-3xl lg:w-fit lg:max-w-[calc(100vw-2rem)]">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{cell ? `${cell.row.className} · 숙제 ${cell.round.homeworkDate ?? cell.round.date}${videos.length > 1 ? ` · 영상 ${videos.length}개` : ""}` : "숙제 영상을 확인합니다."}</DialogDescription>
      </DialogHeader>
      {cell && videos.length > 1 ? <div className="flex flex-wrap gap-2" role="group" aria-label="볼 영상 고르기">
        {videos.map((v, i) => <button key={v.id} type="button" aria-pressed={v.id === video?.id}
          className="border-line aria-pressed:bg-primary aria-pressed:text-primary-foreground rounded-lg border px-3 py-1 text-sm"
          onClick={() => setPicked(v.id)}>영상 {i + 1}<span className="ml-1 opacity-70">{kstDateOf(v.postedAt)?.slice(5).replace("-", ".")}</span></button>)}
      </div> : null}
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 lg:w-[min(70rem,calc((100dvh-13rem)*16/9),calc(100vw-31rem))] lg:shrink-0">
          {cell ? playback ? <HomeworkVideoPlayer key={video?.id} videoId={video?.id} preview={playback.preview} thumbnail={playback.thumbnail}
            uploadedAt={playback.uploadedAt} title={title} />
            : <p role="status" className="text-text-dim p-6 text-center text-sm">아직 재생할 수 없는 영상입니다. 잠시 뒤 다시 확인해 주세요.</p> : null}
        </div>
        {/* AI 참고 메모 대상 줄(스위치 켜짐 · 수학 반 — 서버가 정한 `aiReview`)이면 메모를 불러오는 동안에도 자리를 세워 둔다 — 처음부터 좌우로
            뜨게(원장 2026-10-21 "처음부터 1번 사진처럼"). 🔴 줄의 `subject`는 화면용 한글 라벨이라 과목 키로 비교하지 말 것(적대적 재리뷰). */}
        {cell && video?.id ? <AiReviewPanel key={video.id} videoId={video.id} reserve={!!cell.row.aiReview} /> : null}
      </div>
    </DialogContent>
  </Dialog>;
}
