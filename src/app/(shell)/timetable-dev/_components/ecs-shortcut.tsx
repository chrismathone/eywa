// 시간표 → English Class Sheet 바로가기(영어 과목을 보고 있을 때만 렌더 — 조건 판정은 page.tsx).
// WindowLink를 쓰는 이유: 이 앱은 메뉴=플로팅 창이라 최상위 프레임에서 router.push하면 배경만 바뀌어
// 창에 가려 안 보인다(gotcha #86). WindowLink는 최상위에선 ecs 창(자기 크기 1400×760)을 열고,
// 창 안에서는 그 창에서 드릴인한다(shift+클릭 = 별도 창). 반 상세 'Class Sheet' 버튼과 같은 패턴.
// 보고 있던 주(week)를 그대로 넘겨 타임머신 상태가 끊기지 않게 한다.
import { Button } from "@/components/ui/button";
import { WindowLink } from "@/components/workspace/window-link";

export function EcsShortcut({ week }: { week: string }) {
  return (
    <Button
      variant="outline"
      render={<WindowLink href={`/ecs?week=${week}`} title="영어 강사 시트" />}
    >
      ECS 바로가기
    </Button>
  );
}
