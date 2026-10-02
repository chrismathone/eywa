// 시간표 → 시간표 편집기(연습본) 바로가기. 누가 보는지는 page.tsx가 정한다(`canUseTimetableEditor` — 편집기 화면·API와 같은 판정).
// `frameTarget="window"`: 시간표 창 안에서 눌러도 그 창이 편집기로 바뀌지 않고 **편집기 창이 따로** 열린다 —
// 운영 시간표를 옆에 두고 보면서 연습본을 고칠 수 있어야 한다.
import { Button } from "@/components/ui/button";
import { WindowLink } from "@/components/workspace/window-link";

export function EditorShortcut() {
  return (
    <Button
      variant="outline"
      title="운영 시간표를 복사해 자유롭게 고쳐 보는 연습본 편집기 — 운영 시간표는 바뀌지 않습니다"
      render={<WindowLink href="/timetable/editor" title="시간표 편집기" frameTarget="window" />}
    >
      시간표 편집기
    </Button>
  );
}
