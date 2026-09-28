import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";

/** 슈퍼관리자 고객센터 두 면 — 개선요청(기본) · 공지사항. 지점 화면의 면 순서와 달리 운영자는 처리할 일부터. */
export function SupportAdminTabs({ active }: { active: "requests" | "notices" }) {
  return (
    <ToolbarSegment label="면">
      <ToolbarSegmentItem active={active === "requests"} href="/super-admin/support">
        개선요청
      </ToolbarSegmentItem>
      <ToolbarSegmentItem active={active === "notices"} href="/super-admin/support/notices">
        공지사항
      </ToolbarSegmentItem>
    </ToolbarSegment>
  );
}
