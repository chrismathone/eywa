"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useSheetT } from "@/features/teacher-view/lang-context";
import { PhotoMarkupControls } from "./photo-markup-controls";
import { usePhotoMarkup } from "./use-photo-markup";
import { usePhotoViewportHeight } from "./use-photo-viewport";

export function PhotoMarkupEditor({ file, name, onApply, onClose }: { file: File; name: string; onApply: (file: File) => void; onClose: () => void }) {
  const t = useSheetT();
  const viewportHeight = usePhotoViewportHeight();
  const editor = usePhotoMarkup(file, onApply);
  const { canvasRef, stageRef, image, display, busy, error, pointerDown, pointerMove, pointerEnd } = editor;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent showCloseButton={false} style={{ height: viewportHeight || undefined }} className="inset-0 top-0 left-0 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-none">
      <header className="border-line bg-card flex shrink-0 items-center gap-3 border-b px-3 py-2 pt-[max(.5rem,env(safe-area-inset-top))]">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>{t("os.photo.editCancel")}</Button>
        <div className="min-w-0 flex-1"><DialogTitle>{t("os.photo.edit")}</DialogTitle><p className="text-text-dim truncate text-xs">{name}</p></div>
        <Button size="sm" disabled={busy || !image} onClick={() => void editor.apply()}>{t(busy ? "os.photo.editApplying" : "os.photo.editApply")}</Button>
      </header>
      <DialogDescription className="bg-card shrink-0 px-3 py-1 text-xs">{t("os.photo.editHint")}</DialogDescription>
      <div ref={stageRef} className="bg-bg-soft relative min-h-0 flex-1 overflow-auto overscroll-contain">
        {!image ? <p role="status" className="p-6 text-center text-sm">{t(error ? "os.photo.editFailed" : "os.photo.editLoading")}</p> : <div className="flex min-h-full min-w-full w-fit items-center justify-center">
          <canvas ref={canvasRef} style={{ ...display, touchAction: "none" }} aria-label={t("os.photo.edit")} role="img"
            className="block shrink-0" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd} />
        </div>}
      </div>
      {error && image ? <p role="alert" className="text-danger bg-card shrink-0 px-3 py-1 text-xs">{t("os.photo.editFailed")}</p> : null}
      <PhotoMarkupControls editor={editor} />
    </DialogContent>
  </Dialog>;
}
