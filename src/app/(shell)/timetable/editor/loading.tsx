import { EditorSkeleton } from "./_components/editor-skeleton";

// 편집기 전용 자리 표시 — 없으면 한 단계 위 시간표 loading(주간표 스켈레톤)이 대신 떠서 다른 화면처럼 보인다.
// ⚠️ 루트 className은 page.tsx와 같아야 한다(`.edge-to-edge` = 창에서 좌우·아래 여백 0).
export default function TimetableEditorLoading() {
  return (
    <div className="edge-to-edge h-full min-h-0">
      <EditorSkeleton />
    </div>
  );
}
