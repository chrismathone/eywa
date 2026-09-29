import {
  getStudentLessonReportsPage,
  STUDENT_REPORTS_PAGE_SIZE,
  type LessonReportRow,
} from "@/features/students/server/queries";
import { Pagination } from "@/components/pagination";
import { Button } from "@/components/ui/button";
import { EmbedAnchor, EmbedHiddenInput } from "@/components/embed-link";
import { ProgressContainerPanel } from "@/features/progress/components/progress-panel";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { classnoteBadge } from "@/features/onescreen/classnote-badge";
import { ReportOpenLink } from "./report-open-link";
import { ProgressCell } from "./progress-cell";

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

/**
 * 원생 상세 '진도' 탭 — 수업보고서 **전체**를 10건씩 쪽으로 넘기고, 보고서 날짜로 조회한다
 * (원장 2026-09-18 *"'최근 12'건이 아니고 전체 페이지네이션해서 10건씩 넘기도록 해. 날짜 조회 가능하도록 필터 기능도"*).
 *
 * 🔴 조회는 **GET 폼**(서버 렌더, 클라 상태 없음) — 창 안이면 `embed=1`을 함께 싣는다([[#133]]).
 * 🔴 쪽·날짜 주소 = `page`·`from`·`to`. 탭을 옮기면 탭 링크가 `?tab=`만 싣기 때문에 **저절로 초기화**된다.
 * ⚠️ 날짜를 바꿔 조회하면 1쪽으로 간다(폼이 `page`를 싣지 않는다 — 목록 표준의 page 리셋 규칙).
 */
export async function ProgressTab({
  studentId,
  page = 1,
  from = null,
  to = null,
  back = null,
}: {
  studentId: string;
  page?: number;
  from?: string | null;
  to?: string | null;
  /** 원생 상세의 '돌아가기' 주소 — 쪽을 넘겨도 잃지 않게 함께 싣는다. */
  back?: string | null;
}) {
  // 과목 라벨은 학원설정 단일 소스(하드코딩 금지). 보고서 조회와 독립이라 병렬(B4).
  const [first, settings] = await Promise.all([
    getStudentLessonReportsPage(studentId, { page, from, to }),
    getTenantSettings(),
  ]);
  const totalPages = Math.max(1, Math.ceil(first.total / STUDENT_REPORTS_PAGE_SIZE));
  // 끝 쪽 너머 주소(`page=99` · 조회로 건수가 줄었는데 옛 쪽 번호가 남은 링크)면 **마지막 쪽**을 보여 준다 —
  // 안 그러면 "N건"이라 적어 놓고 빈 표가 선다.
  const shownPage = Math.min(page, totalPages);
  const { rows: reports, total } =
    shownPage !== page ? await getStudentLessonReportsPage(studentId, { page: shownPage, from, to }) : first;
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const filtered = !!(from || to);
  const hrefWith = (opts: { p: number; keepDates: boolean }) => {
    const q = new URLSearchParams({ tab: "progress" });
    if (opts.keepDates && from) q.set("from", from);
    if (opts.keepDates && to) q.set("to", to);
    if (back) q.set("back", back);
    if (opts.p > 1) q.set("page", String(opts.p));
    return `/students/${studentId}?${q.toString()}`;
  };
  const hrefFor = (p: number) => hrefWith({ p, keepDates: true });

  return (
    <div className="space-y-6">
      {/* 진도 컨테이너 자동분석(3b) — 현행/선행 현재위치·속도·또래 백분위·예측·이상감지 */}
      <ProgressContainerPanel studentId={studentId} />

      <header className="border-border flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <h2 className="text-foreground text-base font-bold">수업 진도</h2>
        {/* 날짜 조회 — 보고서 날짜 기준, 양 끝 포함. 비우면 전체. */}
        <form method="get" action={`/students/${studentId}`} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tab" value="progress" />
          {back ? <input type="hidden" name="back" value={back} /> : null}
          <EmbedHiddenInput />
          <input
            type="date"
            name="from"
            defaultValue={from ?? ""}
            aria-label="시작 날짜"
            className="border-border bg-card text-foreground num h-(--control-h-sm) rounded-lg border px-2 text-sm"
          />
          <span className="text-text-dim text-sm">~</span>
          <input
            type="date"
            name="to"
            defaultValue={to ?? ""}
            aria-label="끝 날짜"
            className="border-border bg-card text-foreground num h-(--control-h-sm) rounded-lg border px-2 text-sm"
          />
          <Button type="submit" size="sm">
            날짜 보기
          </Button>
          {filtered ? (
            <EmbedAnchor href={hrefWith({ p: 1, keepDates: false })} className="text-text-dim text-sm hover:underline">
              전체 보기
            </EmbedAnchor>
          ) : null}
          <span className="text-muted-foreground num text-xs">
            {filtered ? "조회 " : "전체 "}
            {total}건
          </span>
        </form>
      </header>

      {total === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {filtered ? "이 기간에 기록된 진도가 없습니다" : "기록된 진도가 없습니다"}
        </p>
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
                    <td className="text-foreground break-keep px-4 py-2 text-xs">{r.progress ? <ProgressCell text={r.progress} /> : "—"}</td>
                    <td className="num px-4 py-2 text-center text-xs whitespace-nowrap">{r.examInfo ?? "—"}</td>
                    <td className="px-4 py-2 text-center text-xs whitespace-nowrap">{homeworkMark(r.homeworkScore)}</td>
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
      <Pagination page={shownPage} totalPages={totalPages} total={total} hrefForPage={hrefFor} />
    </div>
  );
}
