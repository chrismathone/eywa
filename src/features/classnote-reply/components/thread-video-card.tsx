"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HomeworkVideoPlayer } from "@/features/students/components/homework-video-player";
import type { ThreadVideo } from "../reply-types";

/** 카드용 썸네일 — 재생기의 접근 확인용(w64)보다 크게. Drive가 아직 썸네일을 못 만들었거나 이 구글 계정이 못 보면 `onError`로 어두운 판만 남는다. */
const tileThumb = (thumbnail: string) => thumbnail.replace(/([?&]sz=)w\d+/, "$1w320");

/**
 * 쓰레드 안의 재생 가능한 영상 하나 — 사진 칸과 같은 줄에 서는 **썸네일 칸**(▶). 누르면 `onOpen`(호출부가 iframe 팝업을 연다).
 * 주소(`links`)는 서버가 열람 게이트를 통과시킨 사람에게만 준다 — 이 칸은 주소가 있을 때만 그려진다.
 */
export function VideoTile({ video, number, onOpen }: { video: ThreadVideo; number: number; onOpen: () => void }) {
  const [thumbOk, setThumbOk] = useState(true);
  const thumb = video.links ? tileThumb(video.links.thumbnail) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`영상 ${number} 재생`}
      className="bg-foreground/85 focus-visible:outline-primary relative block h-20 w-36 overflow-hidden rounded-lg transition hover:opacity-90"
    >
      {thumb && thumbOk ? (
        // eslint-disable-next-line @next/next/no-img-element -- Drive 썸네일(보는 사람의 구글 계정 권한으로 열린다). next/image는 서버가 대신 받아 권한이 맞지 않는다.
        <img src={thumb} alt="" loading="lazy" decoding="async" onError={() => setThumbOk(false)} className="absolute inset-0 size-full object-cover" />
      ) : null}
      <span aria-hidden className="absolute inset-0 flex items-center justify-center">
        <span className="bg-background/90 text-foreground flex size-8 items-center justify-center rounded-full text-sm">▶</span>
      </span>
      <span className="bg-foreground/70 text-background absolute bottom-1 left-1 rounded-full px-1.5 text-xs">영상 {number}</span>
    </button>
  );
}

/** 아직 재생할 수 없는 영상 — 한글 상태 문구 한 줄(보관 중이면 점이 깜빡이고, 열려 있는 동안 다시 확인한다). */
export function VideoStatusLine({ video }: { video: ThreadVideo }) {
  return (
    <p role="status" className="bg-bg-soft text-text-dim mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs break-keep">
      <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${video.pending ? "bg-primary animate-pulse" : "bg-line"}`} />
      {video.label}
    </p>
  );
}

/**
 * 영상 팝업 — 이 창 위에 iframe(Drive 미리보기)으로 바로 재생. 재생기는 학생 '숙제 영상' 탭과 같은 `HomeworkVideoPlayer`
 * (접근 확인·권한 없음 문구 포함). Drive로 나가는 링크는 두지 않는다(원장 2026-10-04).
 */
export function VideoDialog({ video, number, title, onClose }: { video: ThreadVideo | null; number: number; title: string; onClose: () => void }) {
  const links = video?.playable ? video.links : null;
  return (
    <Dialog open={!!links} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title} · 영상 {number}</DialogTitle>
          <DialogDescription>학부모가 ClassNote에 올린 영상입니다.</DialogDescription>
        </DialogHeader>
        {links && video ? (
          <HomeworkVideoPlayer preview={links.preview} thumbnail={links.thumbnail} uploadedAt={video.uploadedAt} title={`${title} 영상 ${number}`} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
