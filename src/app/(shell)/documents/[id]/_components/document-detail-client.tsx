"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Download, ExternalLink, Eye, Loader2, Pencil, Save } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { updateDocument } from "@/features/documents/server/actions";
import { downloadDocument } from "@/features/documents/open-file";
import { WindowLink } from "@/components/workspace/window-link";
import { linkHostLabel, type DocumentKind } from "@/features/documents/categories";

const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

export type DocumentDetailData = {
  id: string;
  title: string;
  /** `document_categories.key` — 학원장이 관리하는 값이라 닫힌 enum이 아니다(0161a). */
  category: string;
  kind: DocumentKind;
  description: string | null;
  fileName: string | null;
  body: string | null;
  linkUrl: string | null;
};

export function DocumentDetailClient({
  doc,
  categoryOptions,
  canWrite,
}: {
  doc: DocumentDetailData;
  /** 서버가 DB에서 읽어 내려준 분류 선택지 — 여기서 상수로 만들지 말 것(추가한 분류가 사라진다). */
  categoryOptions: { value: string; label: string }[];
  canWrite: boolean;
}) {
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
      <form action={formAction} className="bg-card border-line space-y-4 rounded-2xl border p-4">
        <input type="hidden" name="id" value={doc.id} />
        <div className="space-y-1.5">
          <span className="text-foreground block text-sm font-medium">제목 *</span>
          <input name="title" required defaultValue={doc.title} className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <span className="text-foreground block text-sm font-medium">분류</span>
          <SearchableSelect name="category" defaultValue={doc.category} options={categoryOptions} placeholder="분류 선택..." />
        </div>
        {doc.kind === "link" ? (
          <div className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">링크 주소 *</span>
            <input name="linkUrl" required defaultValue={doc.linkUrl ?? ""} className={inputCls} inputMode="url" />
          </div>
        ) : null}
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
            {/* 내부 창 미리보기(드릴인) — 미지원 형식도 창에서 안내 */}
            <Button variant="outline" render={<WindowLink href={`/documents/${doc.id}/preview`} title={doc.title} />}>
              <Eye className="size-4" /> 미리보기
            </Button>
          </>
        ) : null}
        {/* 외부 링크는 창(iframe)에 못 태운다(구글드라이브 등이 X-Frame-Options로 차단) → 새 탭. */}
        {doc.kind === "link" && doc.linkUrl ? (
          <Button render={<a href={doc.linkUrl} target="_blank" rel="noopener noreferrer" />}>
            <ExternalLink className="size-4" /> 링크 열기
          </Button>
        ) : null}
        {canWrite ? (
          <Button variant="outline" onClick={() => setEditing(true)}>
            {/* 옆의 '링크 열기'·'다운로드'와 나란히 서므로 무엇을 고치는지 적는다(문서 자체의 정보). */}
            <Pencil className="size-4" /> 문서 수정
          </Button>
        ) : null}
      </div>

      {doc.kind === "link" ? (
        <div className="bg-card border-line rounded-2xl border p-4">
          <p className="text-text-dim text-sm">
            연결된 위치: <span className="text-foreground font-medium">{linkHostLabel(doc.linkUrl) || "—"}</span>
          </p>
          {doc.linkUrl ? (
            <a
              href={doc.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary mt-1 block text-xs break-all hover:underline"
            >
              {doc.linkUrl}
            </a>
          ) : null}
          <p className="text-text-faint mt-2 text-xs">
            원본은 이 학원 서버가 아니라 위 사이트에 있습니다 — 열람 권한은 그곳의 공유 설정을 따릅니다.
          </p>
          {doc.description ? <p className="text-text-dim mt-2 text-sm whitespace-pre-wrap">{doc.description}</p> : null}
        </div>
      ) : doc.kind === "file" ? (
        <div className="bg-card border-line rounded-2xl border p-4">
          <p className="text-text-dim text-sm">
            원본 파일명: <span className="text-foreground font-medium">{doc.fileName ?? "—"}</span>
          </p>
          {doc.description ? <p className="text-text-dim mt-2 text-sm whitespace-pre-wrap">{doc.description}</p> : null}
        </div>
      ) : (
        <div className="bg-card border-line rounded-2xl border p-4">
          {doc.description ? <p className="text-text-faint mb-3 text-xs">{doc.description}</p> : null}
          <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">{doc.body}</p>
        </div>
      )}
    </div>
  );
}
