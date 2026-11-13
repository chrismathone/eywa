import { reportWarning } from "@/lib/observability/report-error";
import { loadTeacherChurn } from "@/features/withdrawals/server/teacher-churn";
import type { ChurnSort } from "@/features/withdrawals/teacher-churn";
import type { ChurnView } from "@/features/withdrawals/teacher-churn-view";
import { TeacherChurnCard } from "./teacher-churn-card";

const CARD = "bg-card shadow-card rounded-2xl p-5";

/**
 * '강사별 퇴원율 추이' 자리(서버) — 페이지가 문(`getTeacherChurnGate`)을 확인한 뒤 Suspense 안에서만 부른다(첫 페인트를 막지 않게).
 * 조회 함수도 같은 문을 다시 지난다(#77 — 화면 조건은 게이트가 아니다). 실패는 빈 표로 위장하지 않고 그렇다고 말한다.
 */
export async function TeacherChurnSection({ initialSort, initialView }: { initialSort: ChurnSort; initialView: ChurnView }) {
  let data: Awaited<ReturnType<typeof loadTeacherChurn>>;
  try {
    data = await loadTeacherChurn();
  } catch (e) {
    reportWarning("퇴원관리 강사별 퇴원율 조회 실패", { scope: "withdrawals.teacherChurn", message: e instanceof Error ? e.message : String(e) });
    return <Notice text="강사별 퇴원율을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요." />;
  }
  if (!data) return null;
  if (!data.teachers.length) return <Notice text="아직 강사평가 집계가 없습니다. 직원 평가 → 직원 포트폴리오에서 집계되면 여기에 달마다 나옵니다." />;
  return <TeacherChurnCard data={data} initialSort={initialSort} initialView={initialView} />;
}

function Notice({ text }: { text: string }) {
  return (
    <section className={CARD} aria-label="강사별 퇴원율 추이">
      <h2 className="text-foreground text-base font-bold">강사별 퇴원율 추이</h2>
      <p className="mt-2 text-sm" role="status">{text}</p>
    </section>
  );
}

/**
 * 흘려받는 동안의 자리 — 실물과 같은 순서(머리 → 요약 줄 → 표·차트 → 범례 줄).
 * 🔴 이 카드는 퇴원관리 **필터 툴바 위**에 있다(page.tsx) — 뼈대가 실물보다 낮으면 카드가 뜨는 순간 툴바가 밀린다.
 *    높이는 처음 여는 보기를 따른다: 표 = 표의 최대 높이(teacher-churn-table.tsx `max-h-[34rem]`과 같이 고칠 것) ·
 *    차트 = 차트 칸(teacher-churn-chart.tsx `h-64` + 위 줄 ≈ 18rem). 강사가 적어 표가 짧으면 뜰 때 위로 줄어든다(아래로 밀리지 않는다).
 */
export function TeacherChurnSkeleton({ view = "table" }: { view?: ChurnView }) {
  return (
    <section className={CARD} aria-busy aria-label="강사별 퇴원율 추이 불러오는 중">
      <h2 className="text-foreground text-base font-bold">강사별 퇴원율 추이</h2>
      <div className="bg-bg-soft mt-2 h-4 w-2/3 animate-pulse rounded" />
      <div className={`bg-bg-soft mt-4 animate-pulse rounded-lg ${view === "chart" ? "h-72" : "h-[34rem]"}`} />
      <div className="bg-bg-soft mt-2 h-4 w-1/2 animate-pulse rounded" />
    </section>
  );
}
