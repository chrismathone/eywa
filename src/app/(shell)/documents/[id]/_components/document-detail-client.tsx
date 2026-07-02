"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Download, Eye, Loader2, Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { updateDocument } from "@/features/documents/server/actions";
import { downloadDocument, previewDocument } from "@/features/documents/open-file";
import {
  CATEGORY_LABEL,
  DOCUMENT_CATEGORIES,
  fileTypeLabel,
  type DocumentCategory,
  type DocumentKind,
} from "@/features/documents/categories";

const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";
const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }));

export type DocumentDetailData = {
  id: string;
  title: string;
  category: DocumentCategory;
  kind: DocumentKind;
  description: string | null;
  fileName: string | null;
  body: string | null;
};

export function DocumentDetailClient({ doc, canWrite }: { doc: DocumentDetailData; canWrite: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, formAction] = useActionState(updateDocument, undefined);
  // 성공 1회 처리 — nonce 키 가드(#67): 저장 성공 시 편집 종료 + 서버 데이터 재렌더.
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (state?.ok && state.nonce && handled.current !== state.nonce) {
      handled.current = state.nonce;
      setEditing(false);
      router.refresh();
    }
  }, [state, router]);

  const typeLabel = fileTypeLabel(doc.kind, doc.fileName, null);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form action={formAction} className="bg-card border-line space-y-4 rounded-md border p-4">
        <input type="hidden" name="id" value={doc.id} />
        <div className="space-y-1.5">
          <span className="text-foreground block text-sm font-medium">제목 *</span>
          <input name="title" required defaultValue={doc.title} className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <span className="text-foreground block text-sm font-medium">분류</span>
          <SearchableSelect name="category" defaultValue={doc.category} options={CATEGORY_OPTIONS} placeholder="분류 선택..." />
        </div>
        <div className="space-y-1.5">
          <span className="text-foreground block text-sm font-medium">설명</span>
          <input name="description" defaultValue={doc.description ?? ""} className={inputCls} />
        </div>
        {doc.kind === "text" ? (
          <div className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">내용 *</span>
            <textarea name="body" required rows={12} defaultValue={doc.body ?? ""} className={`${inputCls} resize-y`} />
          </div>
        ) : null}
        {state?.error ? (
          <p className="text-danger bg-danger-soft border-danger/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
            <AlertCircle className="size-4 shrink-0" /> {state.error}
          </p>
        ) : null}
        <div className="border-line flex items-center justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={() => setEditing(false)}>
            취소
          </Button>
          <Button type="submit">
            <Save className="size-4" /> 저장
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {doc.kind === "file" ? (
          <>
            <Button onClick={() => void run(() => downloadDocument(doc.id))} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              다운로드
            </Button>
            <Button variant="outline" onClick={() => void run(() => previewDocument(doc.id, typeLabel))} disabled={busy}>
              <Eye className="size-4" /> 미리보기
            </Button>
          </>
        ) : null}
        {canWrite ? (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="size-4" /> 수정
          </Button>
        ) : null}
      </div>

      {doc.kind === "file" ? (
        <div className="bg-card border-line rounded-md border p-4">
          <p className="text-text-dim text-sm">
            원본 파일명: <span className="text-foreground font-medium">{doc.fileName ?? "—"}</span>
          </p>
          {doc.description ? <p className="text-text-dim mt-2 text-sm whitespace-pre-wrap">{doc.description}</p> : null}
        </div>
      ) : (
        <div className="bg-card border-line rounded-md border p-4">
          {doc.description ? <p className="text-text-faint mb-3 text-xs">{doc.description}</p> : null}
          <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">{doc.body}</p>
        </div>
      )}
    </div>
  );
}
