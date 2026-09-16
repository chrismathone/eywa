import { getSessionTermsView } from "@/features/billing/session-terms/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { currentPeriod } from "@/features/billing/calc";
import { FilterSelect } from "@/components/filter-select";
import { SearchToggle } from "@/components/search-toggle";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { Pagination } from "@/components/pagination";
import { SessionTermGroups, RefreshPlanButton, type ClassGroup } from "./session-term-table";
import { BillingMonthNav } from "./billing-month-nav";
import { FaceNote } from "./face-note";
import Link from "next/link";
import { SessionTermsState, SessionTermsConfirmedCount } from "./session-terms-state";

const PAGE_SIZE = 25; // 반(그룹) 단위 페이지

/**
 * 회차 확정 면 — 청구=N회 키스톤(docs/per-session-billing-plan.md).
 * 계획 N(자동 산출)은 프리필일 뿐, **확정된 값만 청구값**(N1). invoices.amount_total과 자동 일치화 금지(N2)
 * — 참고 열로만 나란히 보여주고 diff 판단은 사람이 한다(시수 검증 read-only 탭이 2단계).
 */
export async function SessionTermsFace({
  period,
  subject,
  q,
  page,
}: {
  period?: string;
  subject?: string;
  q?: string;
  page?: string;
}) {
  const p = period && /^\d{4}-\d{2}$/.test(period) ? period : currentPeriod();
  const [view, settings] = await Promise.all([getSessionTermsView(p), getTenantSettings()]);
  const subjects = buildSubjectMaps(settings.operations.subjects);

  const allRows = view.rows.map((r) => ({ ...r, subjectLabel: subjects.labelOf(r.subject) }));
  // 과목별 조회는 유지하되 수학·영어의 단가 목록은 같은 학원 설정을 쓴다.
  const presentSubjects = [...new Set(allRows.map((r) => r.subject))].sort();
  const activeSubject = subject && presentSubjects.includes(subject) ? subject : null;
  const bySubject = activeSubject ? allRows.filter((r) => r.subject === activeSubject) : allRows;

  // 검색 = 학생명·반명(부분 일치). 페이저는 검색 결과 기준.
  const query = (q ?? "").trim();
  const filtered = query
    ? bySubject.filter(
        (r) => r.studentName.includes(query) || (r.className ?? "").includes(query),
      )
    : bySubject;

  // 반 단위 그룹핑 — 반별 일괄 확정(원장 지시). 학생명 정렬 유지된 채 반으로 묶고, 반 안은 학년·이름 순.
  const groupMap = new Map<string, ClassGroup>();
  for (const r of filtered) {
    const key = r.classId ?? `noclass:${r.className ?? "?"}`;
    const g =
      groupMap.get(key) ??
      groupMap
        .set(key, { classId: r.classId ?? key, className: r.className ?? "(반 미지정)", subjectLabel: r.subjectLabel, students: [] })
        .get(key)!;
    g.students.push(r);
  }
  const allGroups = [...groupMap.values()];
  for (const g of allGroups)
    g.students.sort(
      (a, b) =>
        (a.studentGrade ?? "").localeCompare(b.studentGrade ?? "", "ko") ||
        a.studentName.localeCompare(b.studentName, "ko"),
    );
  allGroups.sort((a, b) => a.subjectLabel.localeCompare(b.subjectLabel) || a.className.localeCompare(b.className, "ko"));

  const totalPages = Math.max(1, Math.ceil(allGroups.length / PAGE_SIZE));
  const curPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const groups = allGroups.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const monthlyCount = filtered.filter((r) => r.monthlyPrice !== null).length;

  // 필터(과목·검색)를 보존한 채 월·page만 바꾸는 href.
  const hrefFor = (per: string, n = 1) => {
    const qs = new URLSearchParams({ tab: "sessions", period: per });
    if (activeSubject) qs.set("subject", activeSubject);
    if (query) qs.set("q", query);
    if (n > 1) qs.set("page", String(n));
    return `/billing?${qs.toString()}`;
  };
  const pageHref = (n: number) => hrefFor(p, n);

  return (
    <SessionTermsState rows={filtered.map(({ id, confirmedSessions }) => ({ id, confirmedSessions }))}>
    <section className="space-y-4">
      {/* 툴바(지시서 §10) — 월 이동은 공용 BillingMonthNav(옛 h-8 text-xs 화살표 링크 대체) · 과목 칩 줄 → `과목: 전체` 라벨 ·
          상시 검색창 → 검색 토글 · Primary = '계획 갱신'(이 면의 본 동작) 하나. 🔴 툴바 카드 껍데기 없음. */}
      <div className="flex flex-wrap items-center gap-2.5 px-1">
        <BillingMonthNav period={p} hrefFor={(per) => hrefFor(per)} ariaLabel="회차 월 선택" />
        {presentSubjects.length > 1 ? (
          <FilterSelect
            paramName="subject"
            value={activeSubject ?? ""}
            options={presentSubjects.map((sk) => ({ value: sk, label: subjects.labelOf(sk) }))}
            axisLabel="과목"
            ariaLabel="과목 필터"
            className="w-auto"
            triggerClassName={TOOLBAR_SELECT}
          />
        ) : null}
        <SearchToggle placeholder="학생명·반" defaultValue={query} />
        <span className="text-text-dim text-sm whitespace-nowrap">
          반 <span className="num">{allGroups.length}</span>개 · 확정{" "}
          <SessionTermsConfirmedCount />/<span className="num">{filtered.length}</span>건
          {monthlyCount > 0 ? ` · 월 정액 ${monthlyCount}건` : null}
        </span>
        <div className="ml-auto">
          <RefreshPlanButton period={p} />
        </div>
        <Link href="/owner?tab=billing" className="text-primary text-sm underline-offset-2 hover:underline">
          단가 설정
        </Link>
      </div>

      {/* 규칙 설명(N1/N2)은 지워선 안 되는 사실이라 접힌 2차로(§4). */}
      <FaceNote>
        회차를 비우고 <b>단가 일괄 입력</b>을 누르면 미확정 학생의 단가 입력칸만 채웁니다(저장 전).
        회차와 단가를 모두 입력한 뒤 <b>이 반 일괄 확정</b>을 누르면 입력한 회차 × 단가로 확정됩니다.
        개별 행에서는 예상금액을 확인한 뒤 <b>확정</b>하세요. 확정한 값만 청구
        기준으로 인정되며, 청구액과의 차이는 자동으로 맞추지 않습니다(차이가 곧 점검 신호). 단가 후보는{" "}
        <Link
          href="/owner?tab=billing"
          className="text-primary underline-offset-2 hover:underline"
        >
          학원 설정 → 수납·청구
        </Link>
        에서 등록·수정할 수 있습니다. 수학·영어는 같은 목록을 쓰며, 같은 금액은 한 번만 표시됩니다.
        {" "}EiE는 <b>월 금액 확정</b> 후 월 수강료에 배분율을 적용합니다(기존 공통 수수료 차감 적용).
        출석 회차가 달라도 월 기준액은 같으며, 설정 변경 전 확정 내역은 해제·재확정 전까지 유지됩니다.
      </FaceNote>

      {filtered.length === 0 ? (
        <div className="border-border text-text-dim rounded-2xl border border-dashed p-10 text-center text-sm">
          {query ? (
            <>“{query}” 검색 결과가 없습니다. 검색어를 조정해 보세요.</>
          ) : (
            <>
              이 달의 회차 데이터가 없습니다. 위의 <b>계획 갱신</b>을 누르면 청구서 기준으로 반별 계획 회차가
              생성됩니다.
            </>
          )}
        </div>
      ) : (
        <>
          <SessionTermGroups key={p} groups={groups} catalog={view.catalog} period={p} />
          <Pagination page={curPage} totalPages={totalPages} total={allGroups.length} hrefForPage={pageHref} />
        </>
      )}
    </section>
    </SessionTermsState>
  );
}
