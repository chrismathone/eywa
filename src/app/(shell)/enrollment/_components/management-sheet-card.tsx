import { EmbedLink } from "@/components/embed-link";
import { tipProps } from "@/components/hover-tip/tip";
import { monthLabel } from "@/lib/date-kst";
import {
  completionRate,
  completionTipCard,
  type ManagementExits,
  type ManagementSheet,
  type SheetCell,
} from "@/features/enrollment/management-sheet";
import { ExitCohortCell } from "./exit-cohort-cell";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const pct = (c: SheetCell) => {
  const r = completionRate(c);
  return r === null ? "—" : `${r}%`;
};
const EMPTY: SheetCell = { total: 0, enrolled: 0, declined: 0, open: 0, longOpen: 0, attending: null };
const SEP = "[&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint";
const TH = "text-muted-foreground px-2 py-1.5 text-right text-xs font-medium whitespace-nowrap";
const TD = "px-2 py-1.5 text-right whitespace-nowrap";

/**
 * 통계 보기 **관리현황**(원장 2026-10-22 *"시트처럼 한눈에 볼 수 있게끔 · 상담대비 완료율 · 수학, 영어 과목별"* → *"통계뷰를 의미함"* ·
 * 2026-10-23 *"수학, 영어 과목별 재원생수가 제대로 체크되지 않는다"*) — 달마다 한 줄: 상담 · 등록 · **재원** · 미등록 · 진행 중 ·
 * **장기 미결** · **완료율**(등록 ÷ 상담 — 마우스를 올리면 내역) · 과목 묶음마다 상담·등록·재원·완료율 · 과목 모름.
 * 맨 위 줄 = 기간 합계(위 헤드라인과 같은 값). 달을 누르면 그 달 목록(시트 모양 목록뷰)으로 간다. 표만 그리는 서버 컴포넌트.
 */
export function ManagementSheetCard({
  sheet,
  groups,
  periodText,
  exits,
}: {
  sheet: ManagementSheet;
  groups: Record<string, { label: string; color: string }>;
  periodText: string;
  /** '등록 후 퇴원' — 퇴원관리를 열 수 있는 사람만(없으면 칸째 없다). */
  exits: ManagementExits | null;
}) {
  const labelOf = (g: string) => groups[g]?.label ?? "그 밖의 과목";
  const showUnknown = sheet.total.unknown > 0;
  // 그 달 상담이 없는 과목 칸 — 재원은 '못 읽음(—)'이 아니라 0명(재원을 읽었으면).
  const none: SheetCell = { ...EMPTY, attending: sheet.total.all.attending === null ? null : 0 };
  return (
    <section className="bg-card shadow-card min-w-0 rounded-2xl p-4">
      <header className="mb-3">
        <h2 className="text-foreground text-sm font-bold">관리현황</h2>
        <ul className="text-text-dim mt-0.5 space-y-0.5 text-xs break-keep">
          <li>{periodText} · 달마다 상담 · 등록 · 완료율 · 과목별 — 두 과목 문의는 양쪽 과목에 셉니다 · 달을 누르면 그 달 목록</li>
          <li>완료율 = 등록 ÷ 상담(위 &lsquo;등록 전환율&rsquo;과 같은 산식) — 아직 결정되지 않은 상담이 많은 최근 달은 낮게 나옵니다 · 마우스를 올리면 내역</li>
          <li>진행 중 = 결정 없이 상담일 60일 이내 · 장기 미결 = 상담일 기준 60일 넘게 결정 없음(오늘 이후 다음 상담일이 잡힌 상담은 진행 중)</li>
          <li>
            재원 = 해당 달 등록 상담에 이어진 학생의 오늘({sheet.asOf}) 재원 — 사람 단위 · 그 과목 반 · 휴원·수업 시작 전 제외 · 원생이 이어진 등록{" "}
            {fmt(sheet.linked)}/{fmt(sheet.total.all.enrolled)}건만 셉니다
          </li>
          {exits ? <li>등록 후 퇴원 = 그 달 상담으로 등록한 학생 중 지금 퇴원 상태인 학생(퇴원관리와 같은 퇴원일 · 누르면 명단)</li> : null}
        </ul>
      </header>
      {sheet.months.length === 0 ? (
        <p className="text-text-dim py-6 text-center text-sm">이 기간에 상담이 없습니다</p>
      ) : (
        <div className="max-h-[440px] overflow-auto overscroll-contain px-1">
          <table className={`num w-full min-w-[820px] border-collapse text-sm ${SEP}`}>
            <thead className="bg-card sticky top-0 z-10">
              <tr className="border-line border-b">
                <th rowSpan={2} className="text-muted-foreground px-2 py-1.5 text-center text-xs font-medium">달</th>
                <th colSpan={exits ? 8 : 7} className="text-foreground px-2 py-1 text-center text-xs font-bold">전체</th>
                {sheet.groups.map((g) => (
                  <th key={g} colSpan={4} className="text-foreground px-2 py-1 text-center text-xs font-bold whitespace-nowrap">
                    <span className="mr-1 inline-block size-2 rounded-full align-middle" style={{ background: groups[g]?.color ?? "var(--color-neutral-fill)" }} />
                    {labelOf(g)}
                  </th>
                ))}
                {showUnknown ? <th rowSpan={2} className={TH}>과목 모름</th> : null}
              </tr>
              <tr className="border-line border-b">
                {/* 이 줄의 첫 칸은 '달'(위 줄이 두 줄을 차지)이 아니라 '상담'이라 표 공통 세로선 규칙이 비껴간다 — 직접 긋는다. */}
                <th className={`${TH} border-line-faint border-l`}>상담</th>
                <th className={TH}>등록</th>
                <th className={TH}>재원</th>
                <th className={TH}>미등록</th>
                <th className={TH}>진행 중</th>
                <th className={TH}>장기 미결</th>
                <th className={TH}>완료율</th>
                {exits ? <th className={TH}>등록 후 퇴원</th> : null}
                {sheet.groups.map((g) => [
                  <th key={`${g}-t`} className={TH}>상담</th>,
                  <th key={`${g}-e`} className={TH}>등록</th>,
                  <th key={`${g}-a`} className={TH}>재원</th>,
                  <th key={`${g}-r`} className={TH}>완료율</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              <tr className="border-line bg-bg-soft/50 border-b font-bold">
                <td className="px-2 py-1.5 text-center whitespace-nowrap">합계</td>
                <Cells cell={sheet.total.all} scope={periodText} wide />
                {exits ? (
                  <td className={TD}>
                    <ExitCohortCell students={exits.total} title={`${periodText} 상담으로 등록한 학생 중 지금 퇴원 상태인 학생`} />
                  </td>
                ) : null}
                {sheet.groups.map((g) => (
                  <Cells key={g} cell={sheet.total.groups[g]!} scope={`${periodText} ${labelOf(g)}`} />
                ))}
                {showUnknown ? <td className={TD}>{fmt(sheet.total.unknown)}</td> : null}
              </tr>
              {sheet.months.map((m) => (
                <tr key={m.month} className="border-line-faint border-b">
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    <EmbedLink href={`/enrollment?view=table&month=${m.month}`} className="text-primary hover:underline" title="이 달 상담 목록">
                      {monthLabel(m.month)}
                    </EmbedLink>
                  </td>
                  <Cells cell={m.all} scope={monthLabel(m.month)} wide />
                  {exits ? (
                    <td className={TD}>
                      <ExitCohortCell students={exits.byMonth[m.month] ?? []} title={`${monthLabel(m.month)} 상담으로 등록한 학생 중 지금 퇴원 상태인 학생`} />
                    </td>
                  ) : null}
                  {sheet.groups.map((g) => (
                    <Cells key={g} cell={m.groups[g] ?? none} scope={`${monthLabel(m.month)} ${labelOf(g)}`} />
                  ))}
                  {showUnknown ? <td className={`${TD} text-text-dim`}>{m.unknown ? fmt(m.unknown) : "—"}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 칸 묶음 — 전체는 상담·등록·재원·미등록·진행 중·장기 미결·완료율, 과목은 상담·등록·재원·완료율. 재원을 못 읽었으면 '—'. */
function Cells({ cell, scope, wide = false }: { cell: SheetCell; scope: string; wide?: boolean }) {
  return (
    <>
      <td className={TD}>{fmt(cell.total)}</td>
      <td className={TD}>{fmt(cell.enrolled)}</td>
      <td className={TD}>{cell.attending === null ? "—" : fmt(cell.attending)}</td>
      {wide ? <td className={`${TD} text-text-dim`}>{fmt(cell.declined)}</td> : null}
      {wide ? <td className={`${TD} text-text-dim`}>{fmt(cell.open)}</td> : null}
      {wide ? <td className={`${TD} text-text-dim`}>{fmt(cell.longOpen)}</td> : null}
      <td className={`${TD} text-foreground font-bold`} {...tipProps(completionTipCard(cell, scope))}>
        {pct(cell)}
      </td>
    </>
  );
}
