import { getSessionTermsView } from "@/features/billing/session-terms/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { currentPeriod } from "@/features/billing/calc";
import { SearchForm } from "@/components/search-form";
import { TOOLBAR_CHIP } from "@/components/toolbar-controls";
import { Pagination } from "@/components/pagination";
import { SessionTermGroups, RefreshPlanButton, type ClassGroup } from "./session-term-table";
import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";

const PAGE_SIZE = 25; // 반(그룹) 단위 페이지

function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

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
  // 과목별 분리(2026-07-13 원장 지시) — 과목마다 단가 체계가 달라 섞어 보면 확정 실수 여지.
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
  const confirmedShown = filtered.filter((r) => r.confirmedSessions !== null).length;

  // 필터(과목·검색·월)를 보존한 채 page만 바꾸는 href.
  const pageHref = (n: number) => {
    const qs = new URLSearchParams({ tab: "sessions", period: p });
    if (activeSubject) qs.set("subject", activeSubject);
    if (query) qs.set("q", query);
    if (n > 1) qs.set("page", String(n));
    return `/billing?${qs.toString()}`;
  };
  const [y, m] = p.split("-");

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/billing?tab=sessions&period=${shiftPeriod(p, -1)}`}
            className="border-line text-text-dim hover:text-foreground inline-flex h-8 items-center rounded-lg border px-2 text-xs"
            aria-label="이전 달"
          >
            <EyIcon name="chevronLeft" size={14} />
          </Link>
          <span className="text-foreground num text-sm font-bold">
            {y}년 {Number(m)}월
          </span>
          <Link
            href={`/billing?tab=sessions&period=${shiftPeriod(p, 1)}`}
            className="border-line text-text-dim hover:text-foreground inline-flex h-8 items-center rounded-lg border px-2 text-xs"
            aria-label="다음 달"
          >
            <EyIcon name="chevronRight" size={14} />
          </Link>
          <span className="text-text-dim ml-2 text-xs">
            반 <span className="num">{allGroups.length}</span>개 · 확정{" "}
            <span className="num">{confirmedShown}</span>/<span className="num">{filtered.length}</span>건
            {query ? <span className="ml-1">· “{query}” 검색</span> : null}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SearchForm
            placeholder="학생명·반"
            defaultValue={query}
            inputWidth="w-32"
            className="flex items-center gap-2"
            resetParams={["page"]}
          />
          <RefreshPlanButton period={p} />
        </div>
      </header>

      {presentSubjects.length > 1 ? (
        <nav className="flex flex-wrap items-center gap-1.5" aria-label="과목별 보기">
          <Link
            href={`/billing?tab=sessions&period=${p}`}
            className={`${TOOLBAR_CHIP} ${!activeSubject ? "border-primary bg-primary text-primary-foreground font-bold" : "border-line text-text-dim hover:text-foreground"}`}
          >
            전체
          </Link>
          {presentSubjects.map((sk) => (
            <Link
              key={sk}
              href={`/billing?tab=sessions&period=${p}&subject=${sk}`}
              className={`${TOOLBAR_CHIP} ${activeSubject === sk ? "border-primary bg-primary text-primary-foreground font-bold" : "border-line text-text-dim hover:text-foreground"}`}
            >
              {subjects.labelOf(sk)}
            </Link>
          ))}
        </nav>
      ) : null}

      <p className="text-text-dim text-xs leading-relaxed">
        각 <b>반</b>의 회당 단가를 입력하고 <b>이 반 일괄 확정</b>을 누르면 그 반 학생 전원이 각자 계획 회차 ×
        단가로 확정됩니다. 학생마다 회차·단가가 다르면 아래 <b>개별</b> 행에서 보정하세요. 확정한 값만 청구
        기준으로 인정되며, 청구액과의 차이는 자동으로 맞추지 않습니다(차이가 곧 점검 신호). 단가 후보는{" "}
        <Link
          href="/billing?tab=calculator&csub=prices&cpmode=per_session"
          className="text-primary underline-offset-2 hover:underline"
        >
          수강료 단가
        </Link>
        에서 <b>회당 단가</b>로 등록·수정할 수 있습니다.
      </p>

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
          <SessionTermGroups groups={groups} catalog={view.catalog} period={p} />
          <Pagination page={curPage} totalPages={totalPages} total={allGroups.length} hrefForPage={pageHref} />
        </>
      )}
    </section>
  );
}
