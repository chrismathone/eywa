"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { useSheetT } from "@/features/teacher-view/lang-context";
import type { PhotoEntry } from "../sequential-photo";
import { capturePhoto, usePhotoCamera } from "./use-photo-camera";

export function PhotoCameraPanel({ entry, index, total, busy, retake, reviewAfter, onPhoto, onMove, onReview }: {
  entry: PhotoEntry; index: number; total: number; busy: boolean;
  retake?: boolean; reviewAfter?: boolean;
  onPhoto: (take: () => Promise<File>) => void;
  onMove: (index: number) => void;
  onReview: () => void;
}) {
  const t = useSheetT();
  const { videoRef, state, start } = usePhotoCamera(true);
  const picker = useRef<HTMLInputElement>(null);
  const target = entry.target;
  const filename = () => `${target.date}_${target.name}_${crypto.randomUUID()}.jpg`;
  return <div className="flex min-h-0 flex-col gap-3">
    <div aria-live="polite" className="flex items-start justify-between gap-3">
      <div><p className="text-foreground text-2xl font-bold">{target.name}</p><p className="text-text-dim text-sm">{target.className}</p></div>
      <span className="text-text-dim shrink-0 text-sm tabular-nums">{index + 1} / {total}</span>
    </div>
    <div className="relative flex h-[min(45dvh,26rem)] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" aria-label={t("os.photo.preview")} />
      {state !== "ready" ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-5 text-center text-white">
        <p>{t(state === "opening" ? "os.photo.opening" : state === "denied" ? "os.photo.denied" : state === "paused" ? "os.photo.paused" : "os.photo.unavailable")}</p>
        {state !== "opening" ? <Button variant="secondary" onClick={() => void start()} disabled={busy}>{t("os.photo.reopen")}</Button> : null}
      </div> : null}
    </div>
    {target.block ? <p role="status" className="text-danger text-sm">{t(`os.photo.block.${target.block}`)}</p> : <p className="text-text-dim text-center text-xs">{t(reviewAfter ? "os.photo.reviewAdvance" : "os.photo.advance")}</p>}
    <div className="flex items-center justify-between gap-3">
      <Button variant="outline" onClick={() => onMove(index - 1)} disabled={busy || index === 0 || reviewAfter}>{t("os.photo.previous")}</Button>
      <button type="button" aria-label={retake ? t("os.photo.retake") : t("os.photo.shutter")}
        disabled={busy || !!target.block || state !== "ready"}
        className="border-primary bg-primary/10 text-primary focus-visible:ring-primary flex size-16 shrink-0 items-center justify-center rounded-full border-4 focus-visible:ring-2 disabled:opacity-30"
        onClick={() => onPhoto(() => capturePhoto(videoRef.current!, filename()))}>
        <span className="bg-primary size-10 rounded-full" />
      </button>
      <Button variant="outline" onClick={reviewAfter ? onReview : () => onMove(index + 1)} disabled={busy}>{t(reviewAfter ? "os.photo.reviewCount" : "os.photo.skip")}</Button>
    </div>
    <div className="flex flex-wrap justify-between gap-2">
      <Button variant="ghost" disabled={busy || !!target.block} onClick={() => picker.current?.click()}>{t("os.photo.native")}</Button>
      <Button variant="secondary" disabled={busy} onClick={onReview}>{t("os.photo.reviewCount")}</Button>
    </div>
    <input ref={picker} type="file" accept="image/*" capture="environment" className="hidden" aria-label={t("os.photo.native")}
      onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file && file.type.startsWith("image/")) onPhoto(() => Promise.resolve(file));
      }} />
  </div>;
}
