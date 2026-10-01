"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ThreadPhoto } from "../reply-types";

/**
 * 쓰레드 안의 사진 하나 — 작은 사진 칸(메신저처럼, 영상 칸과 같은 줄). 누르면 `onOpen`(호출부가 큰 사진을 이 창 위에 띄운다).
 * 주소는 ClassNote 업로드 CDN의 만료 없는 주소(0326a)다. 🔴 서버가 열람 게이트를 통과시킨 사람에게만 내려보낸다.
 * 외부 이미지라 `referrerPolicy="no-referrer"` — aywa 주소를 CDN에 흘리지 않는다.
 */
export function PhotoTile({ photo, number, onOpen }: { photo: ThreadPhoto; number: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`사진 ${number} 크게 보기`}
      className="border-line bg-bg-soft focus-visible:outline-primary block size-20 overflow-hidden rounded-lg border transition hover:opacity-90"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 외부(ClassNote CDN) 사진 — next/image가 서버에서 대신 받으면 no-referrer·무저장 규약이 깨진다. */}
      <img src={photo.small} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-full object-cover" />
    </button>
  );
}

/** 큰 사진 — 이 창 위의 팝업, 여러 장이면 이전·다음. `index`가 null이면 닫혀 있다. */
export function PhotoDialog({ photos, index, title, onIndex }: { photos: ThreadPhoto[]; index: number | null; title: string; onIndex: (i: number | null) => void }) {
  const cur = index === null ? null : (photos[index] ?? null);
  return (
    <Dialog open={cur !== null} onOpenChange={(o) => { if (!o) onIndex(null); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title} · 사진 {index === null ? "" : `${index + 1}/${photos.length}`}</DialogTitle>
          <DialogDescription>학부모가 ClassNote에 올린 사진입니다.</DialogDescription>
        </DialogHeader>
        {cur && index !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- 위와 같다.
          <img src={cur.large} alt={`${title} 사진 ${index + 1}`} referrerPolicy="no-referrer" className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-lg object-contain" />
        ) : null}
        {photos.length > 1 && index !== null ? (
          <div className="flex items-center justify-between text-sm">
            <button type="button" disabled={index === 0} onClick={() => onIndex(Math.max(0, index - 1))} className="text-primary disabled:text-text-faint font-bold">← 이전</button>
            <button type="button" disabled={index === photos.length - 1} onClick={() => onIndex(Math.min(photos.length - 1, index + 1))} className="text-primary disabled:text-text-faint font-bold">다음 →</button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
