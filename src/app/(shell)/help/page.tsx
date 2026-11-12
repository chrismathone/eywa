import { EyIcon } from "@/components/icons/aywa-icons";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchToggle } from "@/components/search-toggle";
import { WindowLink } from "@/components/workspace/window-link";
import { requireAccess } from "@/lib/auth/require-access";
import { getShellView } from "@/lib/auth/view-mode";
import { helpManualForTenant, helpManualOpens } from "@/features/help/access";
import { canAskHelpBoard } from "@/features/help/board/access";
import { getHelpPostsPage } from "@/features/help/board/server/queries";
import { helpAttr } from "@/features/help/help-attr";
import { FAQ } from "@/features/help/hub";
import { MANUALS } from "@/features/help/manuals";
import { HelpAllowProvider } from "./_components/help-text";
import { HelpBoard, HelpFaq, HelpManuals } from "./_help-browser";

export const metadata = { title: "도움말 — 에이와" };

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
    Promise.all(MANUALS.map((m) => helpManualOpens(m, user.systemRole, view))),
    canAskHelpBoard(user.systemRole),
    getHelpPostsPage({ q: q || undefined, page, pageSize: PAGE_SIZE }),
  ]);
  const visibleManuals = await Promise.all(MANUALS.filter((_, i) => manualOpens[i]).map((manual) => helpManualForTenant(manual, user.tenantId)));
  const allowed = visibleManuals.map((m) => m.slug);
  // 🔴 검색 한 칸이 셋을 함께 거른다 — 설명서·Q&A는 여기(서버)서, 게시판은 위 조회가 이미 q로 걸렀다.
  // 칸을 따로 두면 어느 쪽에 치는 건지 사람이 매번 헷갈린다(원장 2026-09-15 "합치기").
  const lower = q.toLowerCase();
  const hit = (s: string) => s.toLowerCase().includes(lower);
  const faq = q ? FAQ.filter((f) => hit(`${f.q} ${f.a}`)) : FAQ;
  const manuals = q
    ? visibleManuals.filter((m) =>
        hit(
          // 면(faces)까지 잇는다 — 수납 '계좌'·출석부 '좌석표'처럼 **그 화면 안 탭에만 있는 말**로 찾는 사람이 있다.
          [
            m.title,
            m.summary,
            ...m.callouts.map((c) => `${c.label} ${c.body}`),
            ...(m.faces ?? []).map(
              (f) => `${f.title} ${f.summary} ${f.callouts.map((c) => `${c.label} ${c.body}`).join(" ")}`,
            ),
          ].join(" "),
        ),
      )
    : visibleManuals;
  // 🔴 게시판은 **총 건수**로 본다(그 페이지의 행이 아니라) — 마지막 페이지를 넘은 주소에서 행만 비면
  // 매칭이 40건이어도 "결과 없음"이 된다. 표가 아직 없거나 조회가 실패하면(`ready=false`) 게시판은
  // 판단에서 빼고, 아래 안내도 "게시판에 물어보라"고 하지 않는다(없는 곳을 가리키게 된다).
  const nothing = q.length > 0 && manuals.length === 0 && faq.length === 0 && (!board.ready || board.total === 0);
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
          description={`화면 설명서 ${manuals.length}개 · 자주 묻는 질문 ${faq.length}개 · F1 = 보고 있는 화면 도움말`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/print/help/manuals" target="_blank" className="border-border hover:bg-bg-soft rounded-md border px-3 py-2 text-sm font-semibold">
                전체 설명서 PDF
              </Link>
              <span {...helpAttr("help-search")}>
                <SearchToggle placeholder="설명서 · 질문 검색" defaultValue={q} />
              </span>
            </div>
          }
        />

        {nothing ? (
          <section className="bg-card shadow-card rounded-2xl p-10 text-center">
            <p className="text-foreground text-sm font-bold">&lsquo;{q}&rsquo; 검색 결과가 없습니다</p>
            <p className="text-text-dim mt-1 text-xs">
              {board.ready && canAsk
                ? "다른 검색어를 넣어 보시거나, 아래 질문 게시판에 직접 물어보세요."
                : "다른 검색어를 넣어 보세요."}
            </p>
          </section>
        ) : null}

        <HelpManuals manuals={manuals} />
        <HelpFaq items={faq} />
        <HelpBoard board={board} canAsk={canAsk} query={q} />
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
            <h2 className="text-foreground mt-0.5 text-base font-bold">에이와 아이콘 시스템</h2>
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
