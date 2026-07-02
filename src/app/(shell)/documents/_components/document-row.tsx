"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  StickyNote,
  Trash2,
} from "lucide-react";
import { WindowLink } from "@/components/workspace/window-link";
import { deleteDocument, signDocumentUrl } from "@/features/documents/server/actions";
import type { DocumentKind } from "@/features/documents/categories";

export type DocumentRowData = {
  id: string;
  title: string;
  kind: DocumentKind;
  description: string | null;
  categoryLabel: string;
  typeLabel: string;
  sizeLabel: string;
  createdAt: string;
  uploaderName: string | null;
};

// 유형 → 탐색기식 파일 아이콘(색으로 형식 구분).
function TypeIcon({ typeLabel, kind }: { typeLabel: string; kind: DocumentKind }) {
  const cls = "size-4 shrink-0";
  if (kind === "text") return <StickyNote className={`${cls} text-text-dim`} />;
  if (typeLabel === "PDF") return <FileText className={`${cls} text-danger`} />;
  if (typeLabel === "Word") return <FileText className={`${cls} text-blue`} />;
  if (typeLabel === "한글") return <FileText className={`${cls} text-blue`} />;
  if (typeLabel === "Excel") return <FileSpreadsheet className={`${cls} text-primary`} />;
  if (typeLabel === "이미지") return <FileImage className={`${cls} text-purple`} />;
  return <File className={`${cls} text-text-dim`} />;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "numeric", day: "numeric" });
}

export function DocumentRow({ doc, canWrite }: { doc: DocumentRowData; canWrite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // 파일 = 클릭 시 새 탭으로 열기/다운로드. 팝업 차단 회피: 제스처 스택에서 동기 open 후 URL 주입.
  async function openFile() {
    if (busy) return;
    setBusy(true);
    const w = window.open("about:blank", "_blank");
    try {
      const res = await signDocumentUrl(doc.id);
      if (res.url && w) w.location.href = res.url;
      else {
        w?.close();
        toast.error(res.error ?? "다운로드 URL 생성 실패");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await deleteDocument(doc.id);
      if (res.error) toast.error(res.error);
      else router.refresh();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <tr className="border-line hover:bg-bg-soft/50 border-t transition-colors">
      <td className="px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <TypeIcon typeLabel={doc.typeLabel} kind={doc.kind} />
          {doc.kind === "file" ? (
            <button
              type="button"
              onClick={openFile}
              disabled={busy}
              className="text-foreground hover:text-primary min-w-0 truncate text-left font-medium hover:underline"
              title={`${doc.title} — 클릭하여 열기/다운로드`}
            >
              {doc.title}
            </button>
          ) : (
            <WindowLink
              href={`/documents/${doc.id}`}
              title={doc.title}
              className="text-foreground hover:text-primary min-w-0 truncate font-medium hover:underline"
            >
              {doc.title}
            </WindowLink>
          )}
        </div>
        {doc.description ? <p className="text-text-faint mt-0.5 truncate pl-6 text-xs">{doc.description}</p> : null}
      </td>
      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{doc.categoryLabel}</td>
      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{doc.typeLabel}</td>
      <td className="text-text-dim num px-3 py-2 text-right whitespace-nowrap">{doc.sizeLabel}</td>
      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{dateLabel(doc.createdAt)}</td>
      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{doc.uploaderName ?? "—"}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        {canWrite ? (
          confirming ? (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <button type="button" onClick={onDelete} disabled={busy} className="text-danger font-semibold hover:underline">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : "삭제"}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-text-dim hover:underline">
                취소
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-text-faint hover:text-danger"
              aria-label={`${doc.title} 삭제`}
              title="삭제"
            >
              <Trash2 className="size-4" />
            </button>
          )
        ) : null}
      </td>
    </tr>
  );
}
