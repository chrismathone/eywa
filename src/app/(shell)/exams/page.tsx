import { redirect } from "next/navigation";
import { UnifiedDashboard } from "./_components/unified-dashboard";
import { requireAccess } from "@/lib/auth/require-access";

export const metadata = { title: "통합 성적관리 — 에이와" };

type ExamsParams = {
  year?: string; term?: string; subject?: string; class?: string; slot?: string; date?: string; max?: string;
  view?: string; type?: string; from?: string; to?: string; jjClass?: string; embed?: string;
  kind?: string; missing?: string; student?: string; page?: string; tab?: string;
  cohortClass?: string; schoolGroup?: string; gradeGroup?: string; entry?: string; entryYear?: string; entryTerm?: string; entrySubject?: string;
  entrySlot?: string; entryClass?: string; entryDate?: string; entryMax?: string;
};

/** 예전 `/exams?...` 즐겨찾기는 학기 격자 입력(`/exams/input`)으로 보내고, 메뉴 기본 주소는 통합 관리 화면으로 연다. */
export default async function ExamsPage({ searchParams }: { searchParams: Promise<ExamsParams> }) {
  await requireAccess("exams");
  const params = await searchParams;
  const legacyInput = Boolean(params.year || params.term || params.class || params.slot || params.date || params.max ||
    params.view === "input" || params.view === "jj" || params.view === "jj_exam" || params.type === "jj");
  if (legacyInput) {
    // 옛 `/exams?year=…` 즐겨찾기 = 학기 격자 입력 — 그 자리(`/exams/input`)로 주소째 옮긴다(embed 포함 전부 보존).
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value && !(key === "view" && value === "input")) next.set(key, value);
    }
    redirect(`/exams/input?${next.toString()}`);
  }
  return <UnifiedDashboard searchParams={params} />;
}
