import { EmbedLink } from "@/components/embed-link";
import { monthLabel } from "@/lib/date-kst";
import { completionRate, type ManagementSheet, type SheetCell } from "@/features/enrollment/management-sheet";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const pct = (c: SheetCell) => {
  const r = completionRate(c);
  return r === null ? "—" : `${r}%`;
};
const SEP = "[&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint";
const TH = "text-muted-foreground px-2 py-1.5 text-right text-xs font-medium whitespace-nowrap";
const TD = "px-2 py-1.5 text-right whitespace-nowrap";

/**
 * 통계 보기 **관리현황**(원장 2026-10-22 *"시트처럼 한눈에 볼 수 있게끔 · 상담대비 완료율 · 수학, 영어 과목별"* → *"통계뷰를 의미함"*) —
 * 달마다 한 줄: 상담 · 등록 · 미등록 · 진행 중 · **완료율**(등록 ÷ 상담) · 과목 묶음마다 상담·등록·완료율 · 과목 모름.
 * 맨 위 줄 = 기간 합계(위 헤드라인과 같은 값). 달을 누르면 그 달 목록(시트 모양 목록뷰)으로 간다. 표만 그리는 서버 컴포넌트.
 */
export function ManagementSheetCard({
  sheet,
  groups,
  periodText,
}: {
  sheet: ManagementSheet;
  groups: Record<string, { label: string; color: string }>;
  periodText: string;
}) {
  const labelOf = (g: string) => groups[g]?.label ?? "그 밖의 과목";
  const showUnknown = sheet.total.unknown > 0;
  return (
    <section className="bg-card shadow-card min-w-0 rounded-2xl p-4">
      <header className="mb-3">
        <h2 className="text-foreground text-sm font-bold">관리현황</h2>
        <p className="text-text-dim mt-0.5 text-xs break-keep">
          {periodText} · 달마다 상담 · 등록 · 완료율(등록 ÷ 상담) · 과목별 — 두 과목 문의는 양쪽 과목에 셉니다 · 달을 누르면 그 달 목록
        </p>
      </header>
      {sheet.months.length === 0 ? (
        <p className="text-text-dim py-6 text-center text-sm">이 기간에 상담이 없습니다</p>
      ) : (
        <div className="max-h-[440px] overflow-auto overscroll-contain px-1">
          <table className={`num w-full min-w-[640px] border-collapse text-sm ${SEP}`}>
            <thead className="bg-card sticky top-0 z-10">
              <tr className="border-line border-b">
                <th rowSpan={2} className="text-muted-foreground px-2 py-1.5 text-center text-xs font-medium">달</th>
                <th colSpan={5} className="text-foreground px-2 py-1 text-center text-xs font-bold">전체</th>
                {sheet.groups.map((g) => (
                  <th key={g} colSpan={3} className="text-foreground px-2 py-1 text-center text-xs font-bold whitespace-nowrap">
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
                <th className={TH}>미등록</th>
                <th className={TH}>진행 중</th>
                <th className={TH}>완료율</th>
                {sheet.groups.map((g) => [
                  <th key={`${g}-t`} className={TH}>상담</th>,
                  <th key={`${g}-e`} className={TH}>등록</th>,
                  <th key={`${g}-r`} className={TH}>완료율</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              <tr className="border-line bg-bg-soft/50 border-b font-bold">
                <td className="px-2 py-1.5 text-center whitespace-nowrap">합계</td>
                <Cells cell={sheet.total.all} wide />
                {sheet.groups.map((g) => (
                  <Cells key={g} cell={sheet.total.groups[g]!} />
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
                  <Cells cell={m.all} wide />
                  {sheet.groups.map((g) => (
                    <Cells key={g} cell={m.groups[g] ?? { total: 0, enrolled: 0, declined: 0, open: 0 }} />
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

/** 칸 묶음 — 전체는 상담·등록·미등록·진행 중·완료율, 과목은 상담·등록·완료율. */
function Cells({ cell, wide = false }: { cell: SheetCell; wide?: boolean }) {
  return (
    <>
      <td className={TD}>{fmt(cell.total)}</td>
      <td className={TD}>{fmt(cell.enrolled)}</td>
      {wide ? <td className={`${TD} text-text-dim`}>{fmt(cell.declined)}</td> : null}
      {wide ? <td className={`${TD} text-text-dim`}>{fmt(cell.open)}</td> : null}
      <td className={`${TD} text-foreground font-bold`}>{pct(cell)}</td>
    </>
  );
}
