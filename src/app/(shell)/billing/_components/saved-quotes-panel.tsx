import { FileText } from "@/components/icons/aywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { SearchToggle } from "@/components/search-toggle";
import { Pagination } from "@/components/pagination";
import { getQuotesPage } from "@/features/billing/server/tuition-quote-queries";
import { getStudentOptions } from "@/features/billing/server/textbook-queries";
import { currentPeriod } from "@/features/billing/calc";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { SavedQuotesList } from "./saved-quotes-list";

type Sp = { q?: string; qpage?: string };
const PAGE_SIZE = 50;

// 저장된 청구서(견적) 목록 — 신입생 상담 견적(tuition_quotes). 클릭 시 계산기로 다시 열기(?qid=).
export async function SavedQuotesPanel({ sp }: { sp: Sp }) {
  const q = sp.q ?? "";
  const page = Math.max(1, Number(sp.qpage) || 1);
  const [{ rows, total }, students, user] = await Promise.all([
    getQuotesPage({ q }, page, PAGE_SIZE),
    getStudentOptions(),
    getCurrentUser(),
  ]);
  // 🔴 한 줄에 판정이 둘이다 — 서버가 다르게 막기 때문이다(감사 2026-11-05).
  //    '청구서로 전환' = createInvoice → canWriteTenant(billing) · 견적 삭제 = deleteTuitionQuote → full(canManageTenant).
  const [canConvert, canDelete] = user
    ? await Promise.all([canWriteTenant(user.systemRole, "billing"), canManageTenant(user.systemRole, "billing")])
    : [false, false];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (n: number) => {
    const p = new URLSearchParams({ tab: "calculator", csub: "quotes" });
    if (q) p.set("q", q);
    if (n > 1) p.set("qpage", String(n));
    return `/billing?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* 🔴 툴바 카드 껍데기 제거(원장 2026-09-01) — 아래 표·카드가 자기 테두리를 가져 선이 겹쳤다. */}
      {/* 검색은 눌러야 나온다(§10). 페이지 파라미터는 `qpage`라 함께 지운다. */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        <p className="text-foreground inline-flex items-center gap-1.5 text-sm font-bold">
          <FileText className="text-primary size-4" />
          저장된 청구서 <span className="num text-text-dim font-normal">{total}건</span>
        </p>
        <SearchToggle placeholder="학생 이름·학교" defaultValue={q} resetParams={["qpage"]} />
      </div>

      {total === 0 ? (
        <EmptyState
          image={q ? "search" : "billing"}
          icon={() => <FileText size={32} strokeWidth={1.8} />}
          title={q ? "검색 결과 없음" : "저장된 견적이 없습니다"}
          description={q ? "검색어를 조정해보세요." : canDelete ? "계산기 탭에서 신입생 상담 견적을 만들어 저장하세요." : undefined}
        />
      ) : (
        <>
          <SavedQuotesList
            rows={rows}
            students={students}
            defaultPeriod={currentPeriod()}
            canConvert={canConvert}
            canDelete={canDelete}
          />
          {totalPages > 1 ? <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} /> : null}
        </>
      )}
    </div>
  );
}
