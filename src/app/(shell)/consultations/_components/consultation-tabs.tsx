import { FaceTabs } from "@/components/face-tabs";

/**
 * 상담 면 전환 — 학생상담(/consultations) ↔ 등록상담(/enrollment)을 한 "상담" 메뉴의 2면으로 통일.
 * 수납·설정처럼 상단 가로 탭바. 두 라우트를 면(href)으로 두어 콘텐츠 이동 없이 교차 전환.
 */
export function ConsultationTabs({ active }: { active: "student" | "enrollment" }) {
  return (
    <FaceTabs
      ariaLabel="상담 면 전환"
      active={active}
      faces={[
        { key: "student", label: "학생상담", href: "/consultations" },
        { key: "enrollment", label: "등록상담", href: "/enrollment" },
      ]}
    />
  );
}
