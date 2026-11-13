"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { PhotoEntry } from "../sequential-photo";

function PhotoThumbnail({ file, name }: { file: File; name: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URL belongs to this mounted thumbnail
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element -- local Blob URL; revoked when the preview unmounts
  return url ? <img src={url} alt={name} className="h-28 w-full rounded-lg bg-bg-soft object-contain" /> : null;
}

export function PhotoReview({ entries, busy, onCapture, onRemove }: {
  entries: PhotoEntry[]; busy: boolean;
  onCapture: (index: number, replace?: number) => void;
  onRemove: (index: number, photo: number) => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  return <div className="flex flex-col divide-y divide-line">
    {entries.map((entry, index) => <section key={entry.target.key} className="py-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div><p className="font-bold">{index + 1}. {entry.target.name}</p><p className="text-text-dim text-xs">{entry.target.className}</p></div>
        {entry.added ? <span className="text-primary text-xs">{tf("os.photo.added", { n: entry.added })}</span> : null}
      </div>
      {entry.error ? <p role="alert" className="text-danger mb-2 text-xs">{t("os.photo.uploadFailed")}</p> : null}
      {entry.target.block ? <p className="text-text-dim text-xs">{t(`os.photo.block.${entry.target.block}`)}</p> : <>
        <div className="grid grid-cols-2 gap-2">
          {entry.files.map((file, photo) => <div key={`${file.name}-${photo}`}>
            <PhotoThumbnail file={file} name={`${entry.target.name} ${photo + 1}`} />
            <div className="flex justify-center gap-1">
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => onCapture(index, photo)}>{t("os.photo.retake")}</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => onRemove(index, photo)}>{t("os.photo.remove")}</Button>
            </div>
          </div>)}
        </div>
        {!entry.files.length && !entry.added ? <p className="text-text-faint text-xs">{t("os.photo.skipped")}</p> : null}
        {entry.files.length + entry.added < entry.target.capacity ? <Button variant="outline" size="sm" className="mt-2" disabled={busy} onClick={() => onCapture(index)}>{t("os.photo.more")}</Button> : null}
      </>}
    </section>)}
  </div>;
}
