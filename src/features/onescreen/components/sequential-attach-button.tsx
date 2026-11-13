"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSheetT } from "@/features/teacher-view/lang-context";
import { photoTargets, type PhotoTarget, type SequentialAttach } from "../sequential-photo";
import type { GridRow } from "../grid";
import type { SubjectReport } from "./report-card";
import { useMobileCamera } from "./use-mobile-camera";

const Capture = dynamic(() => import("./sequential-photo-capture").then(m => m.SequentialPhotoCapture), { ssr: false });

export function SequentialAttachButton({ rows, reports, attachment, disabled }: {
  rows: GridRow[]; reports: Record<string, Record<string, SubjectReport>>;
  attachment: SequentialAttach; disabled: boolean;
}) {
  const t = useSheetT();
  const available = useMobileCamera();
  const [session, setSession] = useState<PhotoTarget[] | null>(null);
  const show = available && rows.some(row => row.subject.subjectKey === "english");
  if (!show && !session) return null;
  return <>
    {show ? <Button variant="outline" size="sm" disabled={disabled || attachment.busy} onClick={() => setSession(photoTargets(rows, reports, attachment.date))}>{t("os.photo.title")}</Button> : null}
    {session ? <Capture targets={session} onAttach={attachment.onAttach} onUploadingChange={attachment.onUploadingChange} onClose={() => setSession(null)} /> : null}
  </>;
}
