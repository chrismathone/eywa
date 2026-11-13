"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { PHOTO_STICKERS } from "../photo-markup";
import type { PhotoMarkupController } from "./use-photo-markup";

export function PhotoMarkupControls({ editor }: { editor: PhotoMarkupController }) {
  const t = useSheetT();
  const tf = useSheetTf();
  const [stickers, setStickers] = useState(false);
  const { current, busy, image, marks } = editor;
  const off = busy || !image;
  return <div className="border-line bg-card flex shrink-0 flex-col gap-2 border-t px-3 py-2 pb-[max(.5rem,env(safe-area-inset-bottom))]">
    {marks.length ? <div className="flex gap-1 overflow-x-auto" aria-label={t("os.photo.editLayers")}>
      {marks.map((mark, i) => <Button key={mark.id} variant={editor.selected === mark.id ? "secondary" : "ghost"} size="sm"
        disabled={off} aria-pressed={editor.selected === mark.id} aria-label={tf("os.photo.editLayer", { n: i + 1, text: mark.text })}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
        onKeyDown={event => {
          const dx = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
          const dy = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
          if ((!dx && !dy) || off) return;
          event.preventDefault();
          const step = event.shiftKey ? 0.05 : 0.01;
          editor.setSelected(mark.id); editor.nudge(mark.id, dx * step, dy * step);
        }}
        onClick={() => editor.setSelected(mark.id)} className="max-w-32 shrink-0 truncate">{mark.text}</Button>)}
    </div> : null}
    <div className="flex flex-wrap items-center gap-1.5">
      <Button variant="outline" size="sm" disabled={off || marks.length >= 24} onClick={() => editor.add("text", t("os.photo.editDefault"))}>{t("os.photo.editAddText")}</Button>
      <Button variant="outline" size="sm" disabled={off || marks.length >= 24} aria-expanded={stickers} onClick={() => setStickers(v => !v)}>{t("os.photo.editSticker")}</Button>
      <Button variant="ghost" size="sm" disabled={off || !current} onClick={editor.remove}>{t("os.photo.remove")}</Button>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="outline" size="icon-sm" disabled={off || editor.zoom <= 1} aria-label={t("os.photo.editZoomOut")} onClick={() => editor.setZoom(z => Math.max(1, z - 0.5))}>−</Button>
        <span className="text-text-dim w-10 text-center text-xs tabular-nums">{Math.round(editor.zoom * 100)}%</span>
        <Button variant="outline" size="icon-sm" disabled={off || editor.zoom >= 3} aria-label={t("os.photo.editZoomIn")} onClick={() => editor.setZoom(z => Math.min(3, z + 0.5))}>+</Button>
      </div>
    </div>
    {stickers ? <div className="flex justify-around gap-1" aria-label={t("os.photo.editSticker")}>
      {PHOTO_STICKERS.map(sticker => <button key={sticker} type="button" disabled={off} className="hover:bg-bg-soft size-11 rounded-lg text-2xl" onClick={() => { editor.add("sticker", sticker); setStickers(false); }}>{sticker}</button>)}
    </div> : null}
    {current?.kind === "text" ? <input aria-label={t("os.photo.editText")} value={current.text} maxLength={120} disabled={off}
      onChange={event => editor.change({ text: event.target.value })} className="border-line bg-card rounded-lg border px-3 py-2 text-base" /> : null}
    {current ? <div className="flex items-center gap-3">
      <label className="text-text-dim flex flex-1 items-center gap-2 text-xs">{t("os.photo.editSize")}
        <input type="range" min="2.5" max="30" step="0.5" value={current.size * 100} disabled={off}
          onChange={event => editor.change({ size: Number(event.target.value) / 100 })} className="min-w-0 flex-1" />
      </label>
      {current.kind === "text" ? <label className="text-text-dim flex items-center gap-2 text-xs">{t("os.photo.editColor")}
        <input type="color" aria-label={t("os.photo.editColor")} value={current.color} disabled={off} onChange={event => editor.change({ color: event.target.value })} className="size-8" />
      </label> : null}
    </div> : null}
  </div>;
}
