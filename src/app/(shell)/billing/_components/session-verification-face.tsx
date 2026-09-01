import { getSessionVerificationView, type VerificationStatus } from "@/features/billing/session-terms/server/verification-queries";
import { getTeacherSplitsStatus } from "@/features/billing/session-terms/server/splits-queries";
import { aggregateTeacherAllocations, hasAllocationSignal } from "@/features/billing/session-terms/allocation";
import { computeSplitRows, splitsFingerprint, totalSplits } from "@/features/billing/session-terms/splits";
import { SplitsSnapshotPanel } from "./splits-snapshot-panel";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { currentPeriod } from "@/features/billing/calc";
import { Pagination } from "@/components/pagination";
import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { TOOLBAR_CHIP } from "@/components/toolbar-controls";

const PAGE_SIZE = 50;

// 시수(배수 합) 표시 — 정수는 그대로("12"), 소수는 한 자리("12.5").
const fmtUnits = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtWon = (n: number) => `${n.toLocaleString("ko-KR")}원`;

function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// diff 색: 일치=녹 / 부족=주황 / 초과=적 / 미확정=회색 (라이트 전용 Daylight).
const STATUS_META: Record<VerificationStatus, { label: string; cell: string; chip: string }> = {
  matched: { label: "일치", cell: "text-green", chip: "bg-green-soft text-green border-green/30" },
  short: { label: "부족", cell: "text-amber", chip: "bg-amber-soft text-amber border-amber/30" },
  over: { label: "초과", cell: "text-danger", chip: "bg-danger-soft text-danger border-danger/30" },
  unconfirmed: { label: "미확정", cell: "text-text-dim", chip: "bg-card text-text-dim border-line" },
};

// 검증 우선 정렬 — 불일치(초과·부족)를 맨 위로, 그다음 미확정, 마지막 일치.
const RANK: Record<VerificationStatus, number> = { over: 0, short: 0, unconfirmed: 1, matched: 2 };

/**
 * 시수 검증 면 — 청구=N회 키스톤의 직접 소비자(로드맵 2단계). **쓰기 0**(조회 전용).
 * 분자=확정값만(N1) / diff는 점검 신호일 뿐 자동수정 없음(N2). 청구월≈달력월 근사(v1 한계).
 */
export async function SessionVerificationFace({
  period,
  subject,
  page,
}: {
  period?: string;
  subject?: string;
  page?: string;
}) {
  const p = period && /^\d{4}-\d{2}$/.test(period) ? period : currentPeriod();
  const [view, settings, savedSplits] = await Promise.all([
    getSessionVerificationView(p),
    getTenantSettings(),
    getTeacherSplitsStatus(p),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  // 분배 스냅샷 드리프트 대조용 — 과목 필터와 무관하게 그 달 전체(저장 단위와 동일 기준).
  // 지문은 강사 귀속까지 포함 — 합계가 상쇄되는 변경(강사 재배정)도 드리프트로 잡는다.
  const liveSplitRows = computeSplitRows(view.rows);
  const liveSplits = { ...totalSplits(liveSplitRows), fingerprint: splitsFingerprint(liveSplitRows) };

  const allRows = view.rows.map((r) => ({ ...r, subjectLabel: subjects.labelOf(r.subject) }));
  const presentSubjects = [...new Set(allRows.map((r) => r.subject))].sort();
  const activeSubject = subject && presentSubjects.includes(subject) ? subject : null;
  const scoped = activeSubject ? allRows.filter((r) => r.subject === activeSubject) : allRows;

  const sorted = [...scoped].sort(
    (a, b) => RANK[a.status] - RANK[b.status] || a.studentName.localeCompare(b.studentName, "ko"),
  );
  const c = view.counts;
  // 그 달 출석 기록이 통째로 없으면(월중·미입력) 전 행 실=0이 되어 고장처럼 보임 → 명시적 안내.
  const noAttendanceYet = sorted.length > 0 && sorted.every((r) => r.actualConsumed === 0);

  // 강사별 분배(참고) — 현재 과목 필터가 적용된 행을 반 담당 강사(id) 단위로 집계(표시 전용, 저장 없음).
  // 전부 0(미확정·출석 0)인 강사 행은 노이즈라 제외 — 신호 있는 강사가 없으면 섹션 자체를 숨긴다.
  const allocations = aggregateTeacherAllocations(
    scoped.map((r) => ({
      className: r.className,
      teacherId: r.teacherId,
      teacherName: r.teacherName,
      confirmedSessions: r.confirmedSessions,
      unitPrice: r.unitPrice,
      amount: r.amount,
      actualConsumed: r.actualConsumed,
    })),
  ).filter(hasAllocationSignal);
  const allocTotal = allocations.reduce(
    (acc, t) => ({
      confirmedAmount: acc.confirmedAmount + t.confirmedAmount,
      actualAmount: acc.actualAmount + t.actualAmount,
    }),
    { confirmedAmount: 0, actualAmount: 0 },
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const curPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const rows = sorted.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const pageHref = (n: number) => {
    const qs = new URLSearchParams({ tab: "verify", period: p });
    if (activeSubject) qs.set("subject", activeSubject);
    if (n > 1) qs.set("page", String(n));
    return `/billing?${qs.toString()}`;
  };
  const [y, m] = p.split("-");

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/billing?tab=verify&period=${shiftPeriod(p, -1)}`}
            className="border-line text-text-dim hover:text-foreground inline-flex h-8 items-center rounded-lg border px-2 text-xs"
            aria-label="이전 달"
          >
            <EyIcon name="chevronLeft" size={14} />
          </Link>
          <span className="text-foreground num text-sm font-bold">
            {y}년 {Number(m)}월
          </span>
          <Link
            href={`/billing?tab=verify&period=${shiftPeriod(p, 1)}`}
            className="border-line text-text-dim hover:text-foreground inline-flex h-8 items-center rounded-lg border px-2 text-xs"
            aria-label="다음 달"
          >
            <EyIcon name="chevronRight" size={14} />
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(["over", "short", "matched", "unconfirmed"] as VerificationStatus[]).map((s) => (
            <span key={s} className={`rounded-full border px-2 py-0.5 ${STATUS_META[s].chip}`}>
              {STATUS_META[s].label} <span className="num font-bold">{c[s]}</span>
            </span>
          ))}
        </div>
      </header>

      {presentSubjects.length > 1 ? (
        <nav className="flex flex-wrap items-center gap-1.5" aria-label="과목별 보기">
          <Link
            href={`/billing?tab=verify&period=${p}`}
            className={`${TOOLBAR_CHIP} ${!activeSubject ? "border-primary bg-primary text-primary-foreground font-bold" : "border-line text-text-dim hover:text-foreground"}`}
          >
            전체
          </Link>
          {presentSubjects.map((sk) => (
            <Link
              key={sk}
              href={`/billing?tab=verify&period=${p}&subject=${sk}`}
              className={`${TOOLBAR_CHIP} ${activeSubject === sk ? "border-primary bg-primary text-primary-foreground font-bold" : "border-line text-text-dim hover:text-foreground"}`}
            >
              {subjects.labelOf(sk)}
            </Link>
          ))}
        </nav>
      ) : null}

      <p className="text-text-dim text-xs leading-relaxed">
        <b>확정한 회차</b>(청구 기준)와 그 반의 <b>실제 소비 출석</b>(출석·지각·조퇴·보강)을 나란히 대조합니다.
        차이는 <span className="text-amber">부족</span>(청구보다 적게 나옴)·<span className="text-danger">초과</span>(더
        나옴) 신호일 뿐, 어느 값도 자동으로 맞추지 않습니다. 회차를 고치려면{" "}
        <Link href={`/billing?tab=sessions&period=${p}`} className="text-primary underline-offset-2 hover:underline">
          회차 확정
        </Link>
        에서 조정하세요. (청구월은 달력월 기준으로 근사합니다.)
      </p>

      {noAttendanceYet ? (
        <div className="rounded-2xl border border-amber/30 bg-amber-soft px-3 py-2 text-xs text-amber">
          이 달은 아직 출석 기록이 없어 실 출석이 모두 <b>0</b>으로 표시됩니다(월중이거나 출석부 미입력). 출석이 쌓이면 자동으로 대조됩니다.
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <div className="border-border text-text-dim rounded-2xl border border-dashed p-10 text-center text-sm">
          이 달의 회차 데이터가 없습니다. <b>회차 확정</b>에서 계획 회차를 생성·확정하면 여기서 실 출석과 대조됩니다.
        </div>
      ) : (
        <>
          {/* 강사별 분배(참고) — 반 담당 강사 단위 확정 금액 vs 실측 금액. 표시 전용 집계(쓰기 0, 저장 없음).
              신호(확정·출석) 있는 강사가 하나도 없으면 통째로 숨김(전부-0 행 노이즈 방지). */}
          {allocations.length > 0 ? (
          <section className="border-line rounded-2xl border">
            <header className="border-line flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2">
              <h3 className="text-foreground text-sm font-bold">강사별 분배 (참고)</h3>
              <p className="text-text-dim text-[11px]">
                반 담당 강사 기준 집계 — 표시 전용이며 어디에도 저장되지 않습니다. 단가 없는 행은 금액에서
                제외하고 개수로 표시합니다.
              </p>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-sm">
                <thead>
                  <tr className="border-line text-text-dim border-b text-xs">
                    <th className="px-3 py-2 text-left font-medium">강사</th>
                    <th className="px-3 py-2 text-right font-medium">반</th>
                    <th className="px-3 py-2 text-right font-medium">확정 회차</th>
                    <th className="px-3 py-2 text-right font-medium">확정 금액</th>
                    <th className="px-3 py-2 text-right font-medium">실 시수</th>
                    <th className="px-3 py-2 text-right font-medium">실측 금액</th>
                    <th className="px-3 py-2 text-right font-medium">차액</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((t) => (
                    <tr key={t.teacherName} className="border-line/60 border-b last:border-0">
                      <td className="text-foreground px-3 py-2">
                        {t.teacherName}
                        {t.missingPriceRows > 0 ? (
                          <span
                            className="text-text-dim ml-1 text-[10px]"
                            title="단가가 없어 금액 집계에서 제외된 행"
                          >
                            (단가없음 {t.missingPriceRows})
                          </span>
                        ) : null}
                      </td>
                      <td className="num text-text-dim px-3 py-2 text-right">{t.classCount}</td>
                      <td className="num px-3 py-2 text-right">{t.confirmedSessions}</td>
                      <td className="num px-3 py-2 text-right">{fmtWon(t.confirmedAmount)}</td>
                      <td className="num px-3 py-2 text-right">{fmtUnits(t.actualUnits)}</td>
                      <td className="num px-3 py-2 text-right">{fmtWon(t.actualAmount)}</td>
                      <td
                        className={`num px-3 py-2 text-right font-bold ${
                          t.diffAmount === 0 ? "text-green" : t.diffAmount > 0 ? "text-danger" : "text-amber"
                        }`}
                      >
                        {t.diffAmount === 0 ? "0" : t.diffAmount > 0 ? `+${fmtWon(t.diffAmount)}` : `−${fmtWon(-t.diffAmount)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-line bg-bg-soft/50 border-t text-xs">
                    <td className="text-text-dim px-3 py-2" colSpan={3}>
                      합계
                    </td>
                    <td className="num px-3 py-2 text-right font-bold">{fmtWon(allocTotal.confirmedAmount)}</td>
                    <td />
                    <td className="num px-3 py-2 text-right font-bold">{fmtWon(allocTotal.actualAmount)}</td>
                    <td
                      className={`num px-3 py-2 text-right font-bold ${
                        allocTotal.actualAmount - allocTotal.confirmedAmount === 0 ? "text-green" : "text-danger"
                      }`}
                    >
                      {fmtWon(allocTotal.actualAmount - allocTotal.confirmedAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
          ) : null}

          {/* 분배 스냅샷(2단계 b) — 확정 행의 강사 분배를 기간 단위로 저장(기록 전용, invoices 불변 N2).
              분배 표가 숨겨져도(신호 0) 저장 이력이 있으면 표시해 stale 스냅샷을 가시화한다.
              key=period: 월 이동 시 useActionState(저장 완료/에러 메시지)를 리셋(적대 리뷰 픽스). */}
          {savedSplits !== null || liveSplits.rowCount > 0 ? (
            <section className="border-line overflow-hidden rounded-2xl border">
              <SplitsSnapshotPanel key={p} period={p} live={liveSplits} saved={savedSplits} />
            </section>
          ) : null}

          <div className="border-line overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-line text-text-dim border-b text-xs">
                  <th className="px-3 py-2 text-left font-medium">학생</th>
                  <th className="px-3 py-2 text-left font-medium">반</th>
                  <th className="px-3 py-2 text-left font-medium">과목</th>
                  <th className="px-3 py-2 text-right font-medium">확정 회차</th>
                  <th className="px-3 py-2 text-right font-medium">실 출석</th>
                  <th className="px-3 py-2 text-right font-medium">차이</th>
                  <th className="px-3 py-2 text-left font-medium">판정</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = STATUS_META[r.status];
                  return (
                    <tr key={r.id} className="border-line/60 border-b last:border-0">
                      <td className="px-3 py-2">
                        <span className="text-foreground">{r.studentName}</span>
                        {r.studentGrade ? <span className="text-text-dim ml-1 text-xs">{r.studentGrade}</span> : null}
                      </td>
                      <td className="text-text-dim px-3 py-2">{r.className ?? "—"}</td>
                      <td className="text-text-dim px-3 py-2">{r.subjectLabel}</td>
                      <td className="num px-3 py-2 text-right">
                        {r.confirmedSessions !== null ? (
                          r.confirmedSessions
                        ) : (
                          <span className="text-text-dim" title="회차 확정 전 — 계획 회차는 참고">
                            {r.plannedSessions ?? "—"}
                            <span className="ml-0.5 text-[10px]">(계획)</span>
                          </span>
                        )}
                      </td>
                      <td className="num text-foreground px-3 py-2 text-right">{fmtUnits(r.actualConsumed)}</td>
                      <td className={`num px-3 py-2 text-right font-bold ${meta.cell}`}>
                        {r.diff === null ? "—" : r.diff > 0 ? `+${fmtUnits(r.diff)}` : fmtUnits(r.diff)}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${meta.chip}`}>{meta.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={curPage} totalPages={totalPages} total={sorted.length} hrefForPage={pageHref} />
        </>
      )}
    </section>
  );
}
