"use client";

import { useState } from "react";
import type { ThreadPhoto, ThreadVideo } from "../reply-types";
import { PhotoDialog, PhotoTile } from "./thread-photo-grid";
import { VideoDialog, VideoStatusLine, VideoTile } from "./thread-video-card";

/**
 * 학부모 글·댓글 하나의 첨부 — 메신저처럼 **영상·사진을 한 줄의 작은 칸으로**(원장 2026-10-01 *"영상&사진 같은느낌으로"* ·
 * *"사진은 썸네일이 좋아. 누르면 크게."*). 영상 칸(▶)을 누르면 공용 재생기 팝업으로 바로 재생, 사진 칸을 누르면 크게.
 * 아직 재생할 수 없는 영상(보관 중·실패·확인 필요)은 칸 대신 한글 상태 한 줄(보관 중이면 창이 열려 있는 동안 다시 확인한다).
 */
export function ThreadMedia({ videos, photos, title, messageId }: { videos: ThreadVideo[]; photos: ThreadPhoto[]; title: string; messageId?: string }) {
  const [video, setVideo] = useState<number | null>(null);
  const [photo, setPhoto] = useState<number | null>(null);
  if (!videos.length && !photos.length) return null;
  // 영상 번호는 이 글의 영상 순서 그대로(재생 가능 여부와 무관) — 보관이 끝나는 순서로 번호가 바뀌지 않게.
  const numbered = videos.map((v, i) => ({ v, n: i + 1 }));
  const playable = numbered.filter(({ v }) => v.playable && v.links);
  const waiting = numbered.filter(({ v }) => !(v.playable && v.links));
  const open = video === null ? null : (numbered[video] ?? null);
  return (
    <>
      {playable.length || photos.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`${title} 첨부`}>
          {playable.map(({ v, n }) => (
            <li key={v.id}>
              <VideoTile video={v} number={n} onOpen={() => setVideo(n - 1)} />
            </li>
          ))}
          {photos.map((p, i) => (
            <li key={`${p.small}-${i}`}>
              <PhotoTile photo={p} number={i + 1} onOpen={() => setPhoto(i)} />
            </li>
          ))}
        </ul>
      ) : null}
      {waiting.map(({ v }) => <VideoStatusLine key={v.id} video={v} />)}
      <VideoDialog video={open?.v ?? null} number={open?.n ?? 0} title={title} messageId={messageId} onClose={() => setVideo(null)} />
      <PhotoDialog photos={photos} index={photo} title={title} onIndex={setPhoto} />
    </>
  );
}
