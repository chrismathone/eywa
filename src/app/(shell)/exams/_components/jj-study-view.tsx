/**
 * 성적관리 › 영어 › **JJ실** — 학생별 기간 학습(인재원 학습 프로그램, 설명서 8번). 서버 컴포넌트.
 *
 * 숫자는 매번 인재원에 묻는다(eywa엔 짝만 있다). 강사는 짝이 걸린 자기 학생(세 갈래 스코프)만 본다(queries.ts).
 * 이름은 인재원 표시 이름이 기본이고, 짝이 있으면 eywa 이름으로 학생 상세(성적 탭)를 연다.
 * ⚠️ 강사는 인재원 반 이름(className)으로 좁혀 부르지 않는다 — 인재원 반은 eywa 반과 1:1이 아니라(테스터 그룹·A반 등)
 *    학원 전체를 받아 eywa 학생 id로 거른다.
 */
import { SearchX } from "@/components/icons/eywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { WindowLink } from "@/components/workspace/window-link";
import { formatStudyTime } from "@/features/ijw/contract";
import type { JjRange } from "@/features/ijw/range";
import { getJjStudyList, type JjViewer } from "@/features/ijw/server/queries";
import { JJ_SCOPE_FAILED, JjFailBanner, JjLinkColumnNotice, JjPeriodLine, rangeNote } from "./jj-shared";

export async function JjStudyView({ viewer, range }: { viewer: JjViewer; range: JjRange }) {
  // 스코프를 못 구했으면 좁게 떨어진 상태 — 빈 표 대신 그 사실을 말한다(인재원도 부르지 않는다).
  if (viewer.scopeFailed) return <JjFailBanner message={JJ_SCOPE_FAILED} />;
  const res = await getJjStudyList(viewer, range.from, range.to);
  if (!res.ok) return <JjFailBanner message={res.message} detail={res.detail} />;
  if (res.scopeNotReady) return <JjLinkColumnNotice teacher />;
  const linked = res.rows.filter((r) => r.eywa).length;
  return (
    <div className="space-y-3">
      {res.columnMissing ? <JjLinkColumnNotice /> : null}
      <JjPeriodLine
        from={res.from}
        to={res.to}
        basis="study"
        note={rangeNote(range, "기본: 최근 7일")}
        extra={`학생 ${res.rows.length}명 · eywa 연결 ${linked}명`}
      />
      {res.rows.length === 0 ? (
        <EmptyState
          image="exams"
          icon={() => <SearchX size={32} strokeWidth={1.8} />}
          title="보여 줄 학생이 없습니다"
          description={
            viewer.teacherStudentIds
              ? "담당 학생 중 인재원 학습 계정과 연결된 학생이 없습니다(연결은 관리자가 합니다)."
              : "인재원에 영어 학생이 아직 없습니다."
          }
        />
      ) : (
        <div className="bg-card shadow-card overflow-auto rounded-2xl">
          <table className="w-full text-sm [&_td]:whitespace-nowrap">
            <thead className="border-line border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-4 py-3 text-left">학생</th>
                <th className="micro px-4 py-3 text-left">인재원 반</th>
                <th className="micro px-4 py-3 text-right">학습한 날</th>
                <th className="micro px-4 py-3 text-right">푼 문제</th>
                <th className="micro px-4 py-3 text-right">정답률</th>
                <th className="micro px-4 py-3 text-right">새 단어</th>
                <th className="micro px-4 py-3 text-right">장기기억</th>
                <th className="micro px-4 py-3 text-right">본 단어</th>
                <th className="micro px-4 py-3 text-right">학습 시간</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {res.rows.map((r) => (
                <tr key={r.ijwId} className="hover:bg-bg-soft/50">
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
                    {!r.eywa ? (
                      <span className="border-amber/40 bg-amber-soft text-amber rounded-pill ml-1.5 border px-1.5 py-px text-xs font-bold">
                        연결 필요
                      </span>
                    ) : null}
                  </td>
                  <td className="text-text-dim px-4 py-2.5 text-xs">{r.className ?? "—"}</td>
                  <td className="num text-foreground px-4 py-2.5 text-right text-xs font-bold">{r.activeDays}일</td>
                  <td className="num text-text-dim px-4 py-2.5 text-right text-xs">{r.answers.toLocaleString("ko-KR")}</td>
                  <td className="num text-text-dim px-4 py-2.5 text-right text-xs">{r.answers ? `${r.accuracy}%` : "—"}</td>
                  <td className="num text-text-dim px-4 py-2.5 text-right text-xs">{r.newWords.toLocaleString("ko-KR")}</td>
                  <td className="num text-text-dim px-4 py-2.5 text-right text-xs">{r.longTermWords.toLocaleString("ko-KR")}</td>
                  <td className="num text-text-dim px-4 py-2.5 text-right text-xs">{r.seenWords.toLocaleString("ko-KR")}</td>
                  <td className="num text-text-dim px-4 py-2.5 text-right text-xs">{formatStudyTime(r.studyMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
