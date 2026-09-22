"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ClipboardList,
  Download,
  ExternalLink,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Pin,
  StickyNote,
  Trash2,
} from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { deleteDocument, toggleDocumentPin } from "@/features/documents/server/actions";
import { downloadDocument } from "@/features/documents/open-file";
import { isPreviewableType, type DocumentKind } from "@/features/documents/categories";
import { splitFileName } from "@/features/documents/file-name";
import { renameDocumentFile } from "@/features/documents/server/file-actions";
import { InlineRename } from "./inline-rename";

export type DocumentRowData = {
  id: string;
  title: string;
  kind: DocumentKind;
  description: string | null;
  categoryLabel: string;
  typeLabel: string;
  sizeLabel: string;
  createdAt: string;
  updatedAt?: string | null;
  fileName?: string | null;
  uploaderName: string | null;
  pinned: boolean;
  /** 이름 클릭 목적지 — 페이지가 kind별로 계산(file=내부 미리보기 / text=상세 / form=이력서 뷰 / link=외부 주소). */
  href: string;
  /** kind='link' — 외부 사이트(구글드라이브 등)라 창 시스템이 아니라 새 브라우저 탭으로 연다. */
  external?: boolean;
};

// 유형 → 탐색기식 파일 아이콘(색으로 형식 구분).
function TypeIcon({ typeLabel, kind }: { typeLabel: string; kind: DocumentKind }) {
  const cls = "size-4 shrink-0";
  if (kind === "form") return <ClipboardList className={`${cls} text-rose`} />;
  if (kind === "link") return <ExternalLink className={`${cls} text-blue`} />;
  if (kind === "text") return <StickyNote className={`${cls} text-text-dim`} />;
  if (typeLabel === "PDF") return <FileText className={`${cls} text-danger`} />;
  if (typeLabel === "Word") return <FileText className={`${cls} text-blue`} />;
  if (typeLabel === "한글") return <FileText className={`${cls} text-blue`} />;
  if (typeLabel === "Excel") return <FileSpreadsheet className={`${cls} text-primary`} />;
  if (typeLabel === "이미지") return <FileImage className={`${cls} text-purple`} />;
  return <File className={`${cls} text-text-dim`} />;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric" });
}

export function DocumentRow({ doc, canWrite }: { doc: DocumentRowData; canWrite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const extension = doc.fileName ? splitFileName(doc.fileName).extension : "";
  const renameBase = extension && doc.title.toLowerCase().endsWith(extension.toLowerCase()) ? doc.title.slice(0, -extension.length) : doc.title;

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  async function onTogglePin() {
    await run(async () => {
      const res = await toggleDocumentPin(doc.id, !doc.pinned);
      if (res.error) toast.error(res.error);
      else router.refresh();
    });
  }

  async function onDelete() {
    await run(async () => {
      const res = await deleteDocument(doc.id);
      if (res.error) toast.error(res.error);
      else router.refresh();
    });
    setConfirming(false);
  }

  return (
    <tr className={`border-line hover:bg-bg-soft/50 border-t transition-colors ${doc.pinned ? "bg-gold-soft/30" : ""}`}>
      <td className="max-w-0 px-4 py-2" title={doc.categoryLabel}>
        <div className="group/name flex min-w-0 items-center gap-2">
          {doc.pinned ? <Pin className="text-gold size-3.5 shrink-0 fill-current" strokeWidth={1.8} /> : null}
          <TypeIcon typeLabel={doc.typeLabel} kind={doc.kind} />
          {/* 이름 클릭 — file=내부 창 미리보기 / text=상세 / form=이력서 뷰(href는 페이지가 계산).
              link=외부 사이트라 창(iframe) 시스템에 못 태운다(구글드라이브 등은 X-Frame-Options로 차단) → 새 탭. */}
          {doc.kind === "file" && doc.fileName ? (
            <InlineRename enabled={canWrite && !busy} name={renameBase} suffix={extension} maxLength={180}
              onSave={(name) => renameDocumentFile(doc.id, name, { title: doc.title, fileName: doc.fileName! })}>
              <WindowLink href={doc.href} title={doc.title} className="text-foreground hover:text-primary block min-w-0 truncate font-medium hover:underline">{doc.title}</WindowLink>
            </InlineRename>
          ) : doc.external ? (
            <a
              href={doc.href}
              target="_blank"
              rel="noopener noreferrer"
              title={doc.href}
              className="text-foreground hover:text-primary min-w-0 truncate font-medium hover:underline"
            >
              {doc.title}
            </a>
          ) : (
            <WindowLink
              href={doc.href}
              title={doc.title}
              className="text-foreground hover:text-primary min-w-0 truncate font-medium hover:underline"
            >
              {doc.title}
            </WindowLink>
          )}
          {doc.kind === "file" && isPreviewableType(doc.typeLabel) ? (
            <span className="text-primary bg-primary/10 shrink-0 rounded px-1.5 py-0.5 text-xs font-bold whitespace-nowrap group-has-[form]/name:hidden">
              미리보기
            </span>
          ) : null}
          {doc.kind === "link" ? (
            <span className="text-blue bg-blue-soft shrink-0 rounded px-1.5 py-0.5 text-xs font-bold whitespace-nowrap">
              외부 링크
            </span>
          ) : null}
        </div>
        {doc.description ? <p className="text-text-faint mt-0.5 truncate pl-6 text-xs">{doc.description}</p> : null}
      </td>
      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{doc.typeLabel}</td>
      <td className="text-text-dim num px-3 py-2 text-right whitespace-nowrap">{doc.sizeLabel}</td>
      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{doc.updatedAt ? new Date(doc.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{dateLabel(doc.createdAt)}</td>
      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{doc.uploaderName ?? "—"}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <span className="inline-flex items-center gap-2">
          {doc.kind === "file" ? (
            <button
              type="button"
              onClick={() => void run(() => downloadDocument(doc.id))}
              disabled={busy}
              className="text-text-faint hover:text-primary"
              aria-label={`${doc.title} 다운로드`}
              title="다운로드"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            </button>
          ) : null}
          {canWrite ? (
            <button
              type="button"
              onClick={() => void onTogglePin()}
              disabled={busy}
              className={doc.pinned ? "text-gold hover:text-text-dim" : "text-text-faint hover:text-gold"}
              aria-label={doc.pinned ? `${doc.title} 고정 해제` : `${doc.title} 상단 고정`}
              title={doc.pinned ? "고정 해제" : "상단 고정"}
            >
              <Pin className={`size-4 ${doc.pinned ? "fill-current" : ""}`} strokeWidth={1.8} />
            </button>
          ) : null}
          {/* 폼 문서(이력서·환불요청서)는 여기서 못 지운다 — 자기 화면에서 관리한다. 이력서는 열람이
              재인증으로 잠겨 있어, 탐색기에서 지울 수 있으면 "못 보는 문서를 지우는" 구멍이 된다(서버도 이중 차단). */}
          {canWrite && doc.kind !== "form" ? (
            confirming ? (
              <span className="inline-flex items-center gap-1.5 text-xs">
                <button type="button" onClick={() => void onDelete()} disabled={busy} className="text-danger font-bold hover:underline">
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
        </span>
      </td>
    </tr>
  );
}
