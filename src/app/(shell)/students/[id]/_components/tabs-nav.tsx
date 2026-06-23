import { FaceTabs, type Face } from "@/components/face-tabs";

// ijw 학생 상세 탭을 이식. '진도'는 Edutrix 보고서 이식(lesson_reports, 0049a) 후 추가.
// 순서(ijw): 개요·수업·성적·진도·출결·상담·메모·수납·타임라인. (교재 탭은 미이식.)
export const STUDENT_TABS = [
  { key: "overview", label: "개요" },
  { key: "classes", label: "수업" },
  { key: "grades", label: "성적" },
  { key: "progress", label: "진도" },
  { key: "attendance", label: "출결" },
  { key: "consultations", label: "상담" },
  { key: "memos", label: "메모" },
  { key: "billing", label: "수납" },
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
