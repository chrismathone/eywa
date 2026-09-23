import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";

/**
 * **입력 ↔ 확인** 전환(원장 2026-09-23: *"이 창은 기입창이고 확인하는 뷰페이지를 추가로"*).
 *
 * 🔑 두 화면은 축이 달라서 주소를 그대로 옮기지 않는다 — 입력은 `시험 칸 하나`, 확인은 `학기 전체`다.
 *    그래서 호출부가 자기 주소를 만들어 넘긴다(여기서 파라미터를 지어내면 엉뚱한 칸으로 간다).
 * ⚠️ 치수는 부품이 든다 — 여기서 `h-*`·`rounded-*`를 적지 말 것(툴바 규약, `toolbar-canon.test.ts`).
 */
export function GradeViewSwitch({
  active,
  inputHref,
  viewHref,
}: {
  active: "input" | "view";
  inputHref: string;
  viewHref: string;
}) {
  return (
    <ToolbarSegment label="보기">
      <ToolbarSegmentItem active={false} href="/exams">
        통합
      </ToolbarSegmentItem>
      <ToolbarSegmentItem active={active === "input"} href={inputHref}>
        입력
      </ToolbarSegmentItem>
      <ToolbarSegmentItem active={active === "view"} href={viewHref}>
        확인
      </ToolbarSegmentItem>
    </ToolbarSegment>
  );
}
