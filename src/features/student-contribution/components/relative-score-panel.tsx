import { getContributionList } from "../server/queries";
import { comparisonOptions, relativeRows } from "../model/relative-score";
import { shiftMonth } from "@/lib/date-kst";
import { RelativeScore } from "./relative-score";

type Input = {
  studentId: string; total: number | null; recent: number; revision: number; refreshedAt: string | null;
};
async function loadRelativeScore({ studentId, total, recent, revision, refreshedAt }: Input) {
  const empty = { options: [], refreshedAt: null, periodLabel: "" };
  try {
    const data = await getContributionList();
    if (!data?.ready || !data.historyReady) return { ...empty, error: "전체 학생 집계가 준비되면 상대 위치를 표시합니다." };
    const rows = relativeRows(data.rows, data.config), student = rows.find(r => r.id === studentId);
    if (total === null) return { ...empty, error: "가족 재원 자료가 확인될 때까지 충성도 상대평가를 보류합니다." };
    if (data.revision !== revision || data.refreshedAt !== refreshedAt || (student?.total !== null && student?.total !== undefined && Math.abs(student.total - total) > .005)
      || (student?.recent !== null && student?.recent !== undefined && Math.abs(student.recent - recent) > .005)) {
      return { ...empty, error: "학생 점수와 비교 집계의 기준이 달라 상대평가를 보류합니다. 최신 집계 후 새로고침해 주세요." };
    }
    return { options: comparisonOptions(rows, studentId), refreshedAt: data.refreshedAt, periodLabel: `${shiftMonth(data.month, -11)} ~ ${data.month} · 이번 달 포함` };
  } catch {
    return { ...empty, error: "비교 자료를 불러오지 못했습니다. 현재 학생의 점수·근거는 아래에서 확인하고, 잠시 후 새로고침해 주세요." };
  }
}
export async function RelativeScorePanel(input: Input) {
  return <RelativeScore {...await loadRelativeScore(input)} />;
}
