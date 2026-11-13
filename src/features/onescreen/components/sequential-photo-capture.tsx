"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { resizeImageForUpload } from "../resize-image";
import { attachPhotoEntries, type PhotoEntry, type PhotoTarget, type SequentialAttach } from "../sequential-photo";
import { PhotoCameraPanel } from "./photo-camera-panel";
import { PhotoReview } from "./photo-review";

export function SequentialPhotoCapture({ targets, onAttach, onUploadingChange, onClose }: {
  targets: PhotoTarget[]; onAttach: SequentialAttach["onAttach"]; onUploadingChange: (busy: boolean) => void; onClose: () => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const [entries, setEntries] = useState<PhotoEntry[]>(() => targets.map(target => ({ target, files: [], added: 0 })));
  const [mode, setMode] = useState<{ index: number; replace?: number; reviewAfter?: boolean }>({ index: 0 });
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState(false);
  const working = useRef(false);
  const alive = useRef(true);
  const attachRef = useRef(onAttach);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { attachRef.current = onAttach; }, [onAttach]);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [review, mode.index]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const count = entries.reduce((n, entry) => n + entry.files.length, 0);
  const rows = entries.filter(entry => entry.files.length).length;
  const close = () => {
    if (working.current) return;
    if (count && !window.confirm(t("os.photo.discard"))) return;
    onClose();
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (count || working.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [count]);
  const move = (index: number) => {
    if (working.current) return;
    setError(false);
    if (index >= entries.length) setReview(true);
    else setMode({ index: Math.max(0, index), replace: entries[index]?.files.length ? 0 : undefined });
  };
  const take = async (capture: () => Promise<File>) => {
    if (working.current || entries[mode.index].target.block) return;
    working.current = true;
    setBusy(true);
    setError(false);
    try {
      const file = await resizeImageForUpload(await capture());
      if (!alive.current) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("unsupported-image");
      setEntries(prev => prev.map((entry, i) => {
        if (i !== mode.index) return entry;
        const files = [...entry.files];
        if (mode.replace !== undefined) files[mode.replace] = file;
        else files.push(file);
        return { ...entry, files, error: false };
      }));
      if (mode.reviewAfter || mode.index + 1 >= entries.length) setReview(true);
      else setMode({ index: mode.index + 1, replace: entries[mode.index + 1].files.length ? 0 : undefined });
    } catch { if (alive.current) setError(true); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  const upload = async () => {
    if (working.current || !count) return;
    working.current = true;
    setUploading(true);
    onUploadingChange(true);
    let remaining = count;
    const pending = entries.map(entry => entry.files.length);
    try {
      await attachPhotoEntries(entries, (target, files) => alive.current ? attachRef.current(target, files) : Promise.resolve(0), (index, next) => {
        remaining -= pending[index] - next.files.length;
        pending[index] = next.files.length;
        if (alive.current) setEntries(prev => prev.map((entry, i) => i === index ? next : entry));
      });
      if (alive.current) setCompleted(remaining === 0);
    } finally { working.current = false; onUploadingChange(false); if (alive.current) setUploading(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-3 overflow-hidden sm:max-w-lg">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <DialogTitle>{t("os.photo.title")}</DialogTitle>
        <Button variant="ghost" size="sm" disabled={busy || uploading} onClick={close}>{t("os.photo.close")}</Button>
      </div>
      <DialogDescription className="shrink-0 text-xs">{targets[0]?.date} · {t(completed ? "os.photo.complete" : review ? "os.photo.reviewHelp" : "os.photo.help")}</DialogDescription>
      {completed ? <p role="status" className="py-8 text-center font-bold">{tf("os.photo.completeCount", { n: entries.reduce((n, e) => n + e.added, 0) })}</p> : <>
        <div ref={bodyRef} className="min-h-0 overflow-y-auto overscroll-contain">
          {review ? <PhotoReview entries={entries} busy={uploading} onCapture={(index, replace) => { setMode({ index, replace, reviewAfter: true }); setReview(false); setError(false); }}
            onReplace={(index, photo, original, edited) => setEntries(prev => prev.map((entry, i) => i === index ? { ...entry, files: entry.files.map((file, p) => p === photo && file === original ? edited : file) } : entry))}
            onRemove={(index, photo) => setEntries(prev => prev.map((entry, i) => i === index ? { ...entry, error: false, files: entry.files.filter((_, p) => p !== photo) } : entry))} />
            : <PhotoCameraPanel entry={entries[mode.index]} index={mode.index} total={entries.length} busy={busy} retake={mode.replace !== undefined} reviewAfter={mode.reviewAfter} onPhoto={capture => void take(capture)} onMove={move} onReview={() => setReview(true)} />}
        </div>
        {error ? <p role="alert" className="text-danger text-xs">{t("os.photo.captureFailed")}</p> : null}
        {review ? <div className="border-line flex shrink-0 flex-col gap-2 border-t pt-3">
          <p aria-live="polite" className="text-text-dim text-center text-xs">{tf("os.photo.summary", { rows, n: count })}</p>
          <Button disabled={uploading || !count} onClick={() => void upload()}>{uploading ? t("os.photo.uploading") : tf("os.photo.confirm", { n: count })}</Button>
        </div> : null}
      </>}
    </DialogContent>
  </Dialog>;
}
