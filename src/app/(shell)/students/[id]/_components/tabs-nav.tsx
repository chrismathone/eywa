import { FaceTabs, type Face } from "@/components/face-tabs";

export const STUDENT_TABS = [
  { key: "overview", label: "개요" },
  { key: "billing", label: "수납" },
  { key: "grades", label: "성적" },
  { key: "attendance", label: "출결" },
  { key: "consultations", label: "상담" },
  { key: "memos", label: "메모" },
  { key: "timeline", label: "타임라인" },
] as const;

export type StudentTabKey = (typeof STUDENT_TABS)[number]["key"];

export function isStudentTabKey(v: string | undefined): v is StudentTabKey {
  return STUDENT_TABS.some((t) => t.key === v);
}

// 공용 FaceTabs(상단 가로 탭바)로 통일 — 수납관리·학원설정과 동일한 면 전환 UI.
export function StudentTabsNav({
  studentId,
  active,
}: {
  studentId: string;
  active: StudentTabKey;
}) {
  const faces: Face[] = STUDENT_TABS.map((t) => ({
    key: t.key,
    label: t.label,
    href: t.key === "overview" ? `/students/${studentId}` : `/students/${studentId}?tab=${t.key}`,
  }));
  return <FaceTabs faces={faces} active={active} ariaLabel="학생 상세 면 전환" />;
}
