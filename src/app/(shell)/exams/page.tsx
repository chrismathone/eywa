import { UnifiedDashboard } from "./_components/unified-dashboard";
import { requireAccess } from "@/lib/auth/require-access";

export const metadata = { title: "통합 성적관리 — aywa" };

type ExamsParams = {
  year?: string; term?: string; subject?: string; class?: string; slot?: string; date?: string; max?: string;
  view?: string; type?: string; from?: string; to?: string; jjClass?: string; embed?: string;
  kind?: string; missing?: string; student?: string; page?: string;
  cohortClass?: string; schoolGroup?: string; gradeGroup?: string; entry?: string; entryYear?: string; entryTerm?: string; entrySubject?: string;
  entrySlot?: string; entryClass?: string; entryDate?: string; entryMax?: string;
};

/** 예전 `/exams?...` 즐겨찾기는 입력 화면으로 보내고, 메뉴 기본 주소는 통합 관리 화면으로 연다. */
export default async function ExamsPage({ searchParams }: { searchParams: Promise<ExamsParams> }) {
  await requireAccess("exams");
  const params = await searchParams;
  const legacyInput = Boolean(params.year || params.term || params.class || params.slot || params.date || params.max ||
    params.view === "input" || params.view === "jj" || params.view === "jj_exam" || params.type === "jj");
  if (legacyInput) {
    const { default: InputPage } = await import("./input/page");
    return <InputPage searchParams={Promise.resolve(params)} />;
  }
  return <UnifiedDashboard searchParams={params} />;
}
