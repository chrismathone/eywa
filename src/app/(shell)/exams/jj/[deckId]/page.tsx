import { notFound } from "next/navigation";
import { WindowLink } from "@/components/workspace/window-link";
import { requireAccess } from "@/lib/auth/require-access";
import { examTypeLabel, formatElapsed, summarizeScores } from "@/features/ijw/contract";
import { ijwConfigFor } from "@/features/ijw/server/client";
import { getJjDeckResults, getJjViewer } from "@/features/ijw/server/queries";
import { JJ_SCOPE_FAILED, JjFailBanner, JjLinkColumnNotice, kstDateTime } from "../../_components/jj-shared";

/**
 * 성적관리 › 영어 › JJ실(시험) › **시험 하나의 학생별 결과**(인재원 설명서 7번).
 * 학생마다 마지막 제출, 점수 높은 순. 강사는 짝이 걸린 자기 학생(세 갈래 스코프)만 보고, 위 요약도 그 학생들로 센다.
 * 🔑 요약은 인재원과 **같은 반올림**(평균 정수, summarizeScores) — 전체를 보는 사람에겐 시험 목록의 평균과 같은 숫자다.
 * ⚠️ 인재원 호출(최대 8초)이 창 첫 페인트를 막지 않게 loading.tsx가 먼저 선다(B7).
 */
export const metadata = { title: "JJ실 시험 결과 — eywa" };

export default async function JjDeckPage({ params }: { params: Promise<{ deckId: string }> }) {
  const user = await requireAccess("exams");
  if (!ijwConfigFor(user.tenantId)) notFound();
  const [{ deckId }, viewer] = await Promise.all([params, getJjViewer()]);
  // 담당(세 갈래) 반에 영어가 없는 강사에겐 JJ 칩이 없다 — 주소를 직접 쳐도 같은 답(#77).
  if (!viewer || !viewer.hasEnglish) notFound();
  if (viewer.scopeFailed) return <JjFailBanner message={JJ_SCOPE_FAILED} />;
  const res = await getJjDeckResults(viewer, deckId);
  if (!res.ok) {
    if (res.kind === "not_found") notFound();
    return <JjFailBanner message={res.message} detail={res.detail} />;
  }
  const stats = summarizeScores(res.rows.map((r) => r.score));
  return (
    <div className="space-y-5">
      <header className="bg-card shadow-card rounded-2xl p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-text-dim text-xs">인재원 JJ실 시험 · {examTypeLabel(res.deck.examType)}</span>
          {viewer.teacherStudentIds ? <span className="text-text-faint text-xs">· 내 학생 기준</span> : null}
        </div>
        <h1 className="text-foreground mt-1 text-xl leading-tight font-bold">{res.deck.name}</h1>
        {res.scopeNotReady ? null : (
          <div className="border-line mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-center sm:grid-cols-4">
            <Stat label="응시" value={stats.count} unit="명" />
            <Stat label="평균" value={stats.avg} unit="점" />
            <Stat label="최고" value={stats.max} unit="점" />
            <Stat label="최저" value={stats.min} unit="점" />
          </div>
        )}
      </header>
      {res.scopeNotReady ? <JjLinkColumnNotice teacher /> : res.columnMissing ? <JjLinkColumnNotice /> : null}
      {res.scopeNotReady ? null : res.rows.length === 0 ? (
        <p className="text-text-faint py-8 text-center text-sm">
          {viewer.teacherStudentIds ? "담당 학생 중 이 시험을 본 학생이 아직 없습니다." : "이 시험을 본 학생이 아직 없습니다."}
        </p>
      ) : (
        <div className="bg-card shadow-card overflow-auto rounded-2xl">
          <table className="w-full text-sm [&_td]:whitespace-nowrap">
            <thead className="border-line border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-4 py-3 text-left">학생</th>
                <th className="micro px-4 py-3 text-left">인재원 반</th>
                <th className="micro px-4 py-3 text-right">점수</th>
                <th className="micro px-4 py-3 text-right">맞은 문항</th>
                <th className="micro px-4 py-3 text-left">제출</th>
                <th className="micro px-4 py-3 text-right">걸린 시간</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {res.rows.map((r) => (
                <tr key={r.attemptId} className="hover:bg-bg-soft/50">
                  <td className="px-4 py-2.5">
                    {r.eywa ? (
                      <WindowLink
                        href={`/students/${r.eywa.studentId}?tab=grades`}
                        title={r.eywa.name}
                        className="text-foreground text-sm font-bold hover:underline"
                      >
                        {r.eywa.name}
                      </WindowLink>
                    ) : (
                      <span className="text-foreground text-sm font-bold">{r.name || r.ijwId}</span>
                    )}
                  </td>
                  <td className="text-text-dim px-4 py-2.5 text-xs">{r.className ?? "—"}</td>
                  <td className="num text-foreground px-4 py-2.5 text-right text-sm font-bold">{r.score}</td>
                  <td className="num text-text-dim px-4 py-2.5 text-right text-xs">
                    {r.correct} / {r.total}
                  </td>
                  <td className="num text-text-dim px-4 py-2.5 text-xs">{kstDateTime(r.submittedAt)}</td>
                  <td className="num text-text-dim px-4 py-2.5 text-right text-xs">{formatElapsed(r.elapsedMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// 시험 상세(exams/[id])와 같은 BigStat 톤 — 큰 숫자 + 작은 라벨.
function Stat({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div>
      <p className="text-text-dim text-sm font-medium">{label}</p>
      <p className="mt-1.5 flex items-baseline justify-center gap-1">
        <span className="num text-foreground text-3xl leading-none font-bold tracking-tight">{value ?? "—"}</span>
        {value != null && unit ? <span className="text-text-dim text-sm font-medium">{unit}</span> : null}
      </p>
    </div>
  );
}
