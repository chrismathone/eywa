import { Suspense } from "react";
import { getStudentMathStatus } from "@/features/integrations/todays-math/student-status";

async function StudentMathContent({ studentId }: { studentId: string }) {
  const result = await getStudentMathStatus(studentId);
  if (result.status === "hidden") return null;
  if (result.status !== "ready") {
    return <p className="text-text-dim rounded-xl border p-5 text-sm" role="status">
      {result.status === "not_configured" ? "오늘의수학 연결을 준비하고 있어요." : "오늘의수학 현황을 불러오지 못했어요. 잠시 후 다시 확인해 주세요."}
    </p>;
  }
  const { data } = result;
  if (!data.linked || data.mode !== "active") {
    return <p className="text-text-dim rounded-xl border p-5 text-sm">이 학생의 오늘의수학 연결을 확인 중이에요.</p>;
  }
  const activeClasses = data.classes.filter((item) => item.active);
  return <div className="space-y-5">
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {[
        ["연결 상태", "연결됨"],
        ["배정된 시험", `${data.tests.assigned.toLocaleString("ko-KR")}개`],
        ["완료한 시험", `${data.tests.completed.toLocaleString("ko-KR")}개`],
      ].map(([label, value]) => <div key={label} className="bg-card border-line rounded-xl border p-4">
        <dt className="text-text-dim text-sm">{label}</dt><dd className="mt-2 text-lg font-semibold">{value}</dd>
      </div>)}
    </dl>
    <section className="bg-card border-line rounded-xl border p-5">
      <h3 className="text-sm font-semibold">오늘의수학 수강 반</h3>
      {activeClasses.length ? <ul className="mt-3 space-y-2 text-sm">{activeClasses.map((item) => <li key={item.sourceClassId}>{item.name}</li>)}</ul>
        : <p className="text-text-dim mt-3 text-sm">현재 연결된 수강 반이 없어요.</p>}
      <p className="text-text-dim mt-4 text-xs">최근 학습: {data.lastActivityAt
        ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(data.lastActivityAt))
        : "아직 기록이 없어요"}</p>
    </section>
  </div>;
}

export function TodaysMathTab({ studentId }: { studentId: string }) {
  return <div className="space-y-4">
    <header className="border-border border-b pb-3"><h2 className="text-foreground text-base font-bold">오늘의수학</h2></header>
    <Suspense fallback={<p className="text-text-dim text-sm" role="status">오늘의수학 현황을 불러오는 중이에요.</p>}>
      <StudentMathContent studentId={studentId} />
    </Suspense>
  </div>;
}
