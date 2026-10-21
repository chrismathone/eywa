import type { HomeworkRiskView, UnreadReportsView } from "@/features/dashboard/onescreen/server/queries";

const fmt = (n: number) => n.toLocaleString("ko-KR");

/**
 * 보고서 통계 맨 위 **지금 숫자** — 운영실 '학습 · 학부모 보고' 카드와 같은 함수·같은 과목 축(`loadReportStats().card`). 아래 추이는 기간별 **기록 비율**이라
 * 카드 숫자(최근 7일 학생 수 · 최근 30일 미확인 건수)를 상세에서 찾을 수 없었다(리뷰 2026-10-21). 기간을 바꿔도 이 두 칸은 그대로다.
 */
export function CardNow({ homework, unread, classnoteOn }: { homework: HomeworkRiskView | null; unread: UnreadReportsView | null; classnoteOn: boolean }) {
  return (
    <section aria-label="현재 확인할 항목" className="space-y-1 px-1">
      <p className="text-muted-foreground text-xs break-keep">
        <b className="text-foreground">현재 확인할 항목</b> · 운영실 카드와 같은 집계 기준 · 아래 기간 선택과 상관없이 지금 값
      </p>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Fact
          label={`최근 ${homework?.windowDays ?? 7}일 숙제 60% 미만 기록이 한 번 이상 있는 학생`}
          value={homework ? `${fmt(homework.students)}명` : "—"}
          sub={homework ? `그중 미제출 ${fmt(homework.notSubmitted)}명 · 0% ${fmt(homework.zero)}명(겹칠 수 있음)` : "불러오지 못했습니다"}
        />
        {classnoteOn ? (
          <Fact
            label={`최근 ${unread?.windowDays ?? 30}일(수업일 기준) 학부모 미확인`}
            value={unread ? `${fmt(unread.reports)}건` : "—"}
            sub={unread ? `보낸 뒤 ${unread.graceHours}시간이 지나도 안 연 보고서` : "불러오지 못했습니다"}
          />
        ) : null}
      </dl>
    </section>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-bg-soft/40 rounded-lg px-3 py-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="num text-foreground text-lg font-bold">
        {value}
        {sub ? <span className="text-muted-foreground ml-1.5 text-xs font-medium">{sub}</span> : null}
      </dd>
    </div>
  );
}
