import { EyIcon } from "@/components/icons/eywa-icons";
import { PageHeader } from "@/components/page-header";
import { WindowLink } from "@/components/workspace/window-link";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { requireAccess } from "@/lib/auth/require-access";
import { getShellView } from "@/lib/auth/view-mode";
import { menuKeyForPath } from "@/lib/permissions";
import { helpLinkOpens } from "@/features/help/access";
import { FAQ, QUICKSTART } from "@/features/help/hub";
import { MANUALS } from "@/features/help/manuals";
import { HelpBrowser } from "./_help-browser";
import { HelpAllowProvider } from "./_components/help-text";
import { HelpSearchProvider, HelpSearchToggle } from "./_help-search";

export const metadata = { title: "도움말 — eywa" };

export default async function HelpPage() {
  const [user, view] = await Promise.all([requireAccess("help"), getShellView()]);
  const [quickOpens, manualOpens] = await Promise.all([
    Promise.all(QUICKSTART.map((s) => helpLinkOpens(menuKeyForPath(s.href), user.systemRole, view))),
    Promise.all(MANUALS.map((m) => helpLinkOpens(m.menuKey, user.systemRole, view))),
  ]);
  const quickstart = QUICKSTART.filter((_, i) => quickOpens[i]);
  const manuals = MANUALS.filter((_, i) => manualOpens[i]);

  return (
    <HelpSearchProvider>
      <HelpAllowProvider slugs={manuals.map((m) => m.slug)}>
        <div className="space-y-6 compact-chrome:space-y-4">
          <PageHeader
            eyebrow="안내"
            title="도움말"
            description={`빠른 시작 ${quickstart.length}단계 · 화면 설명서 ${manuals.length}개 · FAQ ${FAQ.length}개`}
            actions={<HelpSearchToggle />}
          />

          <HelpBrowser quickstart={quickstart} manuals={manuals} faq={FAQ} />

          <section className="bg-card shadow-card flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center">
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
              className={`${CONTROL_H} ${CONTROL_LABEL} text-primary hover:bg-bg-soft inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 font-medium whitespace-nowrap transition`}
            >
              아이콘 보기 <EyIcon name="arrowRight" size={18} className="opacity-60" />
            </WindowLink>
          </section>

          <div className="lg:max-w-md">
            <section className="bg-card shadow-card rounded-2xl p-5">
              <p className="editorial-eyebrow">1:1 문의</p>
              <h3 className="text-foreground mt-1.5 text-lg leading-tight font-bold">도움이 필요하시면 언제든</h3>
              <p className="text-text-dim num mt-2 text-sm">평일 10:00–18:00 · 1670-0000</p>
              <a
                href="tel:1670-0000"
                className={`${CONTROL_H} ${CONTROL_LABEL} text-primary hover:bg-bg-soft mt-3 inline-flex items-center gap-1 rounded-md px-1.5 font-medium whitespace-nowrap transition`}
              >
                상담 예약하기 <EyIcon name="arrowRight" size={18} className="opacity-60" />
              </a>
            </section>
          </div>
        </div>
      </HelpAllowProvider>
    </HelpSearchProvider>
  );
}
