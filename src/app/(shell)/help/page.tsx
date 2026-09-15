import { EyIcon } from "@/components/icons/eywa-icons";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchToggle } from "@/components/search-toggle";
import { WindowLink } from "@/components/workspace/window-link";
import { requireAccess } from "@/lib/auth/require-access";
import { getShellView } from "@/lib/auth/view-mode";
import { helpLinkOpens } from "@/features/help/access";
import { canAskHelpBoard } from "@/features/help/board/access";
import { getHelpPostsPage } from "@/features/help/board/server/queries";
import { helpAttr } from "@/features/help/help-attr";
import { FAQ } from "@/features/help/hub";
import { MANUALS } from "@/features/help/manuals";
import { HelpAllowProvider } from "./_components/help-text";
import { HelpBoard, HelpFaq } from "./_help-browser";

export const metadata = { title: "도움말 — eywa" };

const PAGE_SIZE = 20;

export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; embed?: string }>;
}) {
  const [user, view, sp] = await Promise.all([requireAccess("help"), getShellView(), searchParams]);
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const embed = sp.embed === "1";
  const [manualOpens, canAsk, board] = await Promise.all([
    Promise.all(MANUALS.map((m) => helpLinkOpens(m.menuKey, user.systemRole, view))),
    canAskHelpBoard(user.systemRole),
    getHelpPostsPage({ q: q || undefined, page, pageSize: PAGE_SIZE }),
  ]);
  const allowed = MANUALS.filter((_, i) => manualOpens[i]).map((m) => m.slug);
  const faq = q
    ? FAQ.filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(q.toLowerCase()))
    : FAQ;
  const totalPages = Math.max(1, Math.ceil(board.total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    if (embed) params.set("embed", "1");
    const s = params.toString();
    return s ? `/help?${s}` : "/help";
  };

  return (
    <HelpAllowProvider slugs={allowed}>
      <div className="space-y-6 compact-chrome:space-y-4">
        <PageHeader
          eyebrow="안내"
          title="도움말"
          description={`F1 = 이 화면 도움말 · 자주 묻는 질문 ${faq.length}개`}
          actions={
            <span {...helpAttr("help-search")}>
              <SearchToggle placeholder="질문 검색" defaultValue={q} />
            </span>
          }
        />

        <HelpFaq items={faq} />
        <HelpBoard board={board} canAsk={canAsk} />
        {board.ready && totalPages > 1 ? (
          <Pagination page={page} totalPages={totalPages} total={board.total} hrefForPage={pageHref} />
        ) : null}

        <section
          {...helpAttr("help-icons")}
          className="bg-card shadow-card flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center"
        >
          <span className="bg-primary-soft text-primary flex size-11 shrink-0 items-center justify-center rounded-lg">
            <EyIcon name="help" size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="editorial-eyebrow">디자인 시스템</p>
            <h2 className="text-foreground mt-0.5 text-base font-bold">Eywa 아이콘 시스템</h2>
            <p className="text-text-dim mt-1 text-xs leading-relaxed">
              제품에서 사용하는 아이콘과 크기, 선, 의미 배정 규칙을 한눈에 확인하세요.
            </p>
          </div>
          <WindowLink
            href="/help/icons"
            className="text-primary hover:bg-bg-soft inline-flex h-(--control-h) shrink-0 items-center gap-1 rounded-md px-1.5 text-sm font-medium whitespace-nowrap transition"
          >
            아이콘 보기 <EyIcon name="arrowRight" size={18} className="opacity-60" />
          </WindowLink>
        </section>
      </div>
    </HelpAllowProvider>
  );
}
