// 서식 파일 다운로드 — 클라 전용 헬퍼(⚠️ server-only 금지 [[#61]], window/document 사용).
// 목록 행·상세·미리보기 창이 공유(라우트 사적 _components 교차 import 회피).
// (미리보기는 새 탭이 아니라 내부 창 라우트 `/documents/[id]/preview` — 이 모듈엔 다운로드만.)
import { toast } from "sonner";
import { signDocumentUrl } from "./server/actions";

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
