/**
 * 수정 화면(`PrepBriefSection pinned`)에서만 쓰는 조각 둘 — 상세 카드엔 안 나온다.
 */
import { Printer } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";

/**
 * 인쇄 = **새 탭**. 인쇄 창 부품(`PrintWindowButton`)은 창(iframe) 안·단일 화면에서 그 화면 자체를 옮겨서,
 * 입력 중인 폼이 확인 없이 사라진다(화면 안 이동이라 미저장 가드가 못 막는다).
 */
export function PinnedPrintLink({ consultationId }: { consultationId: string }) {
  return (
    <Button
      variant="outline"
      render={<a href={`/enrollment/${consultationId}/prep`} target="_blank" rel="noopener noreferrer" />}
    >
      <Printer className="size-4" />
      인쇄
    </Button>
  );
}

/**
 * 🔴 만들기·다시 작성은 **저장된** 상담 내용으로 쓴다(생성 액션이 DB를 읽는다) — 고치는 중인 칸은 안 들어간다.
 * 생성 시각이 방금으로 찍혀 새 입력이 반영된 것처럼 보이지 않게 단추 곁에 적어 둔다.
 */
export function SavedOnlyNote() {
  return (
    <p className="text-text-dim text-xs break-keep">
      저장된 상담 내용으로 작성합니다 — 고친 내용을 반영하려면 먼저 저장하세요.
    </p>
  );
}
