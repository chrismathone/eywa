/**
 * 학생 상세 '성적' 탭 — **JJ실 학습**(인재원 학습 프로그램) 구역. 서버 컴포넌트.
 *
 * 짝(students.ijw_student_id)이 걸린 학생만 보인다 — 짝이 없거나 연동이 설정되지 않은 학원이면 아무것도
 * 그리지 않는다(수학만 듣는 학생 화면에 빈 구역이 생기지 않게). 숫자는 매번 인재원에 묻는다.
 * 학생 상세 자체가 이미 담당 학생 게이트(canViewStudentDetail)를 지난 뒤라 스코프를 다시 계산하지 않는다(getJjAccess).
 * 🔑 두 덩어리의 기간이 다르다 — 위 숫자는 **최근 30일(학습일)**, 아래 시험 표는 **기간과 무관한 최근 시험**(설명서 2번).
 *    한 머리말 아래 두면 표도 30일짜리로 읽힌다(적대 리뷰 2026-09-10) → 덩어리마다 기간을 따로 적는다.
 * 🔴 조회가 실패해도 성적 탭 전체를 죽이지 않는다(getStudentJj는 던지지 않는다) — 이 구역에 한 줄로 알린다.
 */
import { addDays } from "@/lib/date-kst";
import { examTypeLabel, formatStudyTime } from "@/features/ijw/contract";
import { ijwStudyDay } from "@/features/ijw/range";
import { ijwConfigFor } from "@/features/ijw/server/client";
import { getJjAccess, getStudentJj } from "@/features/ijw/server/queries";
import { JjUnlinkButton } from "./jj-unlink-button";

const EXAM_LIMIT = 10;
const STUDY_DAYS = 30;

function kstDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" });
}

export async function StudentJjSection({ studentId }: { studentId: string }) {
  const access = await getJjAccess();
  if (!access || !ijwConfigFor(access.tenantId)) return null;
  // 학습 기간은 **학습일**로 잡는다 — 자정~03시 KST엔 달력 '오늘'이 아직 시작 안 한 학습일이다.
  const to = ijwStudyDay();
  const from = addDays(to, -(STUDY_DAYS - 1));
  const data = await getStudentJj(access.tenantId, studentId, from, to);
  if (data.state === "unlinked") return null;
  if (data.state === "error") {
    return (
      <section className="border-border border-t pt-4">
        <p className="border-amber/40 bg-amber-soft text-amber rounded-xl border px-3 py-2 text-xs" title={data.failed.detail}>
          JJ실 학습 — {data.failed.message}
        </p>
      </section>
    );
  }
  const t = data.study?.totals;
  const exams = data.exams.slice(0, EXAM_LIMIT);
  return (
    <section className="border-border space-y-3 border-t pt-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-foreground text-sm font-bold">
          JJ실 학습 <span className="text-text-faint text-xs font-medium">인재원 계정 {data.ijwId}</span>
        </h3>
        {access.canLink ? <JjUnlinkButton studentId={studentId} /> : null}
      </header>
      {data.failed ? (
        <p className="border-amber/40 bg-amber-soft text-amber rounded-xl border px-3 py-2 text-xs" title={data.failed.detail}>
          {data.failed.message}
        </p>
      ) : null}
      {t ? (
        <div className="space-y-1.5">
          <p className="micro">
            최근 {STUDY_DAYS}일 · 학습일 기준(새벽 3시에 날이 바뀝니다) · <span className="num">{from} ~ {to}</span>
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <Kpi label="학습한 날" value={`${t.activeDays}일`} />
            <Kpi label="푼 문제" value={t.answers.toLocaleString("ko-KR")} />
            <Kpi label="정답률" value={t.answers ? `${t.accuracy}%` : "—"} />
            <Kpi label="장기기억 단어" value={(data.study?.longTermWords ?? 0).toLocaleString("ko-KR")} />
            <Kpi label="학습 시간" value={formatStudyTime(t.studyMs)} />
          </div>
        </div>
      ) : null}
      {exams.length ? (
        <div className="space-y-1.5">
          <p className="micro">최근 본 시험 · 기간과 무관 · 최근 {exams.length}개</p>
          <div className="bg-card border-border overflow-x-auto rounded-2xl border">
            <table className="w-full text-sm">
              <thead className="border-border bg-bg-soft/40 border-b [&_th]:whitespace-nowrap">
                <tr>
                  <th className="micro px-4 py-2 text-left">제출일</th>
                  <th className="micro px-4 py-2 text-left">시험</th>
                  <th className="micro px-4 py-2 text-left">구분</th>
                  <th className="micro px-4 py-2 text-right">점수</th>
                  <th className="micro px-4 py-2 text-right">맞은 문항</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {exams.map((e) => (
                  <tr key={e.attemptId} className="hover:bg-bg-soft/30">
                    <td className="num text-muted-foreground px-4 py-2 text-xs">{kstDate(e.submittedAt)}</td>
                    <td className="text-foreground px-4 py-2 text-xs">{e.deck}</td>
                    <td className="text-muted-foreground px-4 py-2 text-xs">{examTypeLabel(e.examType)}</td>
                    <td className="num text-foreground px-4 py-2 text-right text-xs font-medium">{e.score}</td>
                    <td className="num text-muted-foreground px-4 py-2 text-right text-xs">
                      {e.correct} / {e.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : data.failed ? null : (
        <p className="text-muted-foreground text-xs">인재원에서 본 시험이 아직 없습니다.</p>
      )}
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border-border rounded-2xl border px-3 py-2.5">
      <p className="micro">{label}</p>
      <p className="tabular text-foreground mt-1 text-lg leading-none">{value}</p>
    </div>
  );
}
