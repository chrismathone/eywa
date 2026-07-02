// 서식 파일 열기/다운로드 — 클라 전용 헬퍼(⚠️ server-only 금지 [[#61]], window/document 사용).
// 목록 행·상세 페이지가 공유(라우트 사적 _components 교차 import 회피).
import { toast } from "sonner";
import { signDocumentUrl } from "./server/actions";

/**
 * 미리보기 — 이미지/PDF는 브라우저 네이티브(inline signed URL), Word/Excel은 MS Office 온라인 뷰어
 * (⚠️ 2h 만료 서명 URL이 MS 서버로 전달됨 — 빈 서식 배포 용도라 수용, 민감 문서면 다운로드 사용).
 * 한글(HWP)·기타는 웹 미리보기 불가 → 다운로드로 폴백.
 */
export function previewDocument(id: string, typeLabel: string): Promise<void> {
  const officeViewer = typeLabel === "Word" || typeLabel === "Excel";
  const nativeViewer = typeLabel === "PDF" || typeLabel === "이미지";
  if (!officeViewer && !nativeViewer) {
    toast.info(`${typeLabel} 형식은 웹 미리보기를 지원하지 않아 다운로드합니다`);
    return downloadDocument(id);
  }
  // 팝업 차단 회피 — 제스처 스택에서 동기 open 후 URL 주입.
  const w = window.open("about:blank", "_blank");
  return signDocumentUrl(id, "view").then((res) => {
    if (res.url && w) {
      w.location.href = officeViewer
        ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(res.url)}`
        : res.url;
    } else {
      w?.close();
      toast.error(res.error ?? "미리보기 URL 생성 실패");
    }
  });
}

/** 진짜 다운로드 — attachment disposition 서명 URL을 anchor로 클릭(탭 안 열림, 원본 파일명으로 저장). */
export function downloadDocument(id: string): Promise<void> {
  return signDocumentUrl(id, "download").then((res) => {
    if (!res.url) {
      toast.error(res.error ?? "다운로드 URL 생성 실패");
      return;
    }
    const a = document.createElement("a");
    a.href = res.url;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}
