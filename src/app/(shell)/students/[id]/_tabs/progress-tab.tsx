import { getStudentLessonReports, type LessonReportRow } from "@/features/students/server/queries";
import { ProgressContainerPanel } from "@/features/progress/components/progress-panel";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { classnoteBadge } from "@/features/onescreen/classnote-badge";
import { ReportOpenLink } from "./report-open-link";

// ijw StudentDetail ProgressTab 이식 — 최근 수업보고서 표(날짜·선생님·진도·시험·숙제).
// + P2a/P3 보강: ClassNote 발송 상태 · 학부모 링크(열람수/취소/만료) — "저장한 보고서 확인"을 여기서.
// 숙제 = 저장된 **수행률 값 그대로**(90% 등).
// 🔴 예전엔 `0보다 크면 완료`로 뭉갰다 — 50%도 '완료', 숫자가 아닌 '일부 미흡'도 NaN → '완료'였다.
//    이 표를 보고 직원이 사실과 반대로 판단한다(2026-08-03 수행률 퍼센트 전환과 함께 정리).
function homeworkMark(score: string | null): string {
  return score?.trim() || "—";
}

/**
 * ClassNote 발송 상태 → 짧은 라벨 + 색. null·미지의 값 = 미발송("—").
 *
 * 🔴 여기 **로컬 사본**이 있었는데(2026-08-18 제거) 회수 3종·링크 취소·과목 제외·결석/출결 미체크를
 * switch에서 빠뜨려 **전부 "—"로 삼켰다** — 학부모 게시글을 회수했는데 학생 상세에선 "안 보낸 것"처럼
 * 보였다는 뜻이다. 색 문제가 아니라 상태 은폐 버그였다. 이제
 * [`classnoteBadge`](src/features/onescreen/classnote-badge.ts) 정본 하나만 쓴다(좁은 칸이라
 * `short` 라벨). 상태가 늘면 정본만 고치면 여기도 따라온다.
 * ⚠️ import는 **순수 모듈**에서 — 이 파일은 서버 컴포넌트라 클라 컴포넌트(`components/report-card.tsx`,
 *    `useState` 사용)를 거치면 빌드가 깨진다(그래서 정본을 컴포넌트 밖으로 옮겼다).
 */
function classnoteCell(status: string | null): { label: string; cls: string } {
  const b = classnoteBadge(status);
  return b ? { label: b.short, cls: b.cls } : { label: "—", cls: "text-text-faint" };
}

/** 학부모 링크 상태 → 라벨 + 색. 활성이면 열람 수(0=미열람). */
function linkBadge(row: LessonReportRow): { label: string; cls: string } {
  if (row.linkStatus === "revoked") return { label: "취소됨", cls: "text-danger" };
  if (row.linkStatus === "expired") return { label: "만료", cls: "text-text-faint" };
  if (row.viewCount > 0) return { label: `${row.viewCount}회 열람`, cls: "text-foreground" };
  return { label: "미열람", cls: "text-text-dim" };
}

export async function ProgressTab({ studentId }: { studentId: string }) {
  // 과목 라벨은 학원설정 단일 소스(하드코딩 금지). 보고서 조회와 독립이라 병렬(B4).
  const [reports, settings] = await Promise.all([
    getStudentLessonReports(studentId, 12),
    getTenantSettings(),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);

  return (
    <div className="space-y-6">
      {/* 진도 컨테이너 자동분석(3b) — 현행/선행 현재위치·속도·또래 백분위·예측·이상감지 */}
      <ProgressContainerPanel studentId={studentId} />

      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-bold">수업 진도</h2>
        <p className="text-muted-foreground num text-xs">최근 {reports.length}건</p>
      </header>

      {reports.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">기록된 진도가 없습니다</p>
      ) : (
        <div className="bg-card border-border overflow-x-auto rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="border-border bg-bg-soft/40 border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-4 py-2 text-left">날짜</th>
                {/* 🔴 과목 열은 2026-07-29 감사로 신설 — 없을 땐 영어 강사 화면에서 수학 진도 12줄이
                    그 학생의 '수업 진도'로 읽혔다(쿼리가 subject를 select조차 안 했다). */}
                <th className="micro px-4 py-2 text-left">과목</th>
                <th className="micro px-4 py-2 text-left">선생님</th>
                <th className="micro px-4 py-2 text-left">진도</th>
                <th className="micro px-4 py-2 text-center">시험</th>
                <th className="micro px-4 py-2 text-center">숙제</th>
                <th className="micro px-4 py-2 text-center">ClassNote</th>
                <th className="micro px-4 py-2 text-center">학부모 링크</th>
                {/* 실제 수업보고서 바로가기(원장 2026-09-18). 🔴 학부모 링크(`/r/…`)로 보내지 말 것 — 그 페이지는
                    워커 밖의 **모든 방문을 학부모 열람으로 적는다**(바로 옆 '학부모 링크' 열이 "1회 열람"으로 오염된다).
                    내부 문서(`/lesson_reports/[id]/print`)는 **같은 카드**(ParentReportCard)를 그리되 열람을 안 적고,
                    강사 게이트도 이 탭과 같은 함수(`canViewStudentDetail`)다. */}
                <th className="micro px-4 py-2 text-center">보고서</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {reports.map((r) => {
                const cn = classnoteCell(r.classnoteStatus);
                const link = linkBadge(r);
                return (
                  <tr key={r.id} className="hover:bg-bg-soft/30 align-top">
                    <td className="num text-muted-foreground px-4 py-2 text-xs whitespace-nowrap">{r.reportDate}</td>
                    <td className="text-text-dim px-4 py-2 text-xs whitespace-nowrap">{subjects.labelOf(r.subject)}</td>
                    <td className="text-foreground px-4 py-2 text-xs whitespace-nowrap">{r.teacherName ?? "—"}</td>
                    <td className="text-foreground break-keep px-4 py-2 text-xs">{r.progress ?? "—"}</td>
                    <td className="num px-4 py-2 text-center text-xs whitespace-nowrap">{r.examInfo ?? "—"}</td>
                    <td className="px-4 py-2 text-center text-xs">{homeworkMark(r.homeworkScore)}</td>
                    <td className={`px-4 py-2 text-center text-xs font-bold whitespace-nowrap ${cn.cls}`}>
                      {cn.label}
                    </td>
                    <td className={`px-4 py-2 text-center text-xs whitespace-nowrap ${link.cls}`}>{link.label}</td>
                    <td className="px-4 py-2 text-center text-xs whitespace-nowrap">
                      <ReportOpenLink reportId={r.id} reportDate={r.reportDate} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
