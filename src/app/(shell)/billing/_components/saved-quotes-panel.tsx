import { FileText } from "@/components/icons/eywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { SearchForm } from "@/components/search-form";
import { Pagination } from "@/components/pagination";
import { getQuotesPage } from "@/features/billing/server/tuition-quote-queries";
import { getStudentOptions } from "@/features/billing/server/textbook-queries";
import { currentPeriod } from "@/features/billing/calc";
import { SavedQuotesList } from "./saved-quotes-list";

type Sp = { q?: string; qpage?: string };
const PAGE_SIZE = 50;

// 저장된 청구서(견적) 목록 — 신입생 상담 견적(tuition_quotes). 클릭 시 계산기로 다시 열기(?qid=).
export async function SavedQuotesPanel({ sp }: { sp: Sp }) {
  const q = sp.q ?? "";
  const page = Math.max(1, Number(sp.qpage) || 1);
  const [{ rows, total }, students] = await Promise.all([
    getQuotesPage({ q }, page, PAGE_SIZE),
    getStudentOptions(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (n: number) => {
    const p = new URLSearchParams({ tab: "calculator", csub: "quotes" });
    if (q) p.set("q", q);
    if (n > 1) p.set("qpage", String(n));
    return `/billing?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
        <p className="text-foreground inline-flex items-center gap-1.5 text-sm font-bold">
          <FileText className="text-primary size-4" />
          저장된 청구서 <span className="num text-text-dim font-normal">{total}건</span>
        </p>
        <SearchForm
          placeholder="학생 이름·학교"
          defaultValue={q}
          inputWidth="w-36"
          resetParams={["qpage"]}
        />
      </div>

      {total === 0 ? (
        <EmptyState
          image={q ? "search" : "billing"}
          icon={() => <FileText size={32} strokeWidth={1.5} />}
          title={q ? "검색 결과 없음" : "저장된 견적이 없습니다"}
          description={q ? "검색어를 조정해보세요." : "계산기 탭에서 신입생 상담 견적을 만들어 저장하세요."}
        />
      ) : (
        <>
          <SavedQuotesList rows={rows} students={students} defaultPeriod={currentPeriod()} />
          {totalPages > 1 ? <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} /> : null}
        </>
      )}
    </div>
  );
}
