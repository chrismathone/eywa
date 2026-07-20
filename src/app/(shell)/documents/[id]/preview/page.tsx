import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { BackLink } from "@/components/back-link";
import { Pill } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import { getDocumentById } from "@/features/documents/server/queries";
import { resolveTenantReadUrl } from "@/lib/storage/media-storage";
import { fileTypeLabel, formatFileSize } from "@/features/documents/categories";
import { PreviewDownloadButton } from "./_components/preview-download-button";

export const metadata = { title: "문서 미리보기 — eywa" };

// 내부 창 미리보기 — 이미지/PDF는 서명 URL을 직접 렌더(완전 내부), Word/Excel은 MS Office 온라인
// 뷰어를 창 안에 임베드(⚠️ 2h 만료 서명 URL이 MS 서버로 전달됨 — 빈 서식 배포 용도라 수용).
// HWP·기타는 웹 렌더러가 없어 안내 + 다운로드.
export default async function DocumentPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("documents");
  const { id } = await params;
  const doc = await getDocumentById(id);
  if (!doc || doc.kind !== "file" || !doc.filePath) notFound();

  const typeLabel = fileTypeLabel(doc.kind, doc.fileName, doc.mimeType);
  const mode =
    typeLabel === "이미지"
      ? ("image" as const)
      : typeLabel === "PDF"
        ? ("pdf" as const)
        : typeLabel === "Word" || typeLabel === "Excel"
          ? ("office" as const)
          : ("none" as const);

  let src: string | null = null;
  let resolveError: string | null = null;
  if (mode !== "none") {
    try {
      const url = await resolveTenantReadUrl(doc.filePath, "document", user.tenantId);
      src = mode === "office" ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}` : url;
    } catch (e) {
      resolveError = e instanceof Error ? e.message : "미리보기 URL 생성 실패";
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <BackLink href="/documents" label="데이터베이스로" />
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Pill color={mode === "none" ? "neutral" : "blue"}>{typeLabel}</Pill>
          <h1 className="text-foreground min-w-0 truncate text-base font-bold">{doc.title}</h1>
          <span className="text-text-faint text-xs whitespace-nowrap">{formatFileSize(doc.fileSize)}</span>
        </div>
        <div className="flex items-center gap-3">
          <WindowLink
            href={`/documents/${doc.id}`}
            title={doc.title}
            className="text-text-dim hover:text-foreground text-xs whitespace-nowrap hover:underline"
          >
            상세·수정
          </WindowLink>
          <PreviewDownloadButton id={doc.id} />
        </div>
      </header>

      {resolveError ? (
        <div className="bg-danger-soft border-danger/20 text-danger rounded-2xl border p-4 text-sm">{resolveError}</div>
      ) : mode === "image" && src ? (
        <div className="bg-bg-soft/60 border-line flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-2xl border p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- 서명 URL 미리보기(최적화 불필요) */}
          <img src={src} alt={doc.title} className="max-h-full max-w-full object-contain" />
        </div>
      ) : (mode === "pdf" || mode === "office") && src ? (
        <div className="border-line min-h-0 flex-1 overflow-hidden rounded-2xl border">
          <iframe src={src} title={`${doc.title} 미리보기`} className="h-full min-h-[420px] w-full" />
        </div>
      ) : (
        <div className="bg-bg-soft/60 border-line text-text-dim flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-2xl border p-8 text-center text-sm">
          <p className="text-foreground font-medium">{typeLabel} 형식은 웹 미리보기를 지원하지 않습니다</p>
          <p className="text-text-faint text-xs">위 다운로드 버튼으로 받아 프로그램에서 열어주세요.</p>
        </div>
      )}

      {mode === "office" ? (
        <p className="text-text-faint text-[11px]">Microsoft Office 온라인 뷰어로 표시 중 — 원본은 다운로드 버튼으로 받으세요.</p>
      ) : null}
    </div>
  );
}
