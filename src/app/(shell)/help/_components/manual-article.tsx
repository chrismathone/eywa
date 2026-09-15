import { EyIcon } from "@/components/icons/eywa-icons";
import { PageHeader } from "@/components/page-header";
import { WindowLink } from "@/components/workspace/window-link";
import type { HelpManual } from "@/features/help/types";
import { GuideBlock } from "./guide-block";
import { HelpText } from "./help-text";
import { OpenScreen } from "./open-screen";

export function ManualArticle({
  manual,
  related,
}: {
  manual: HelpManual;
  related: HelpManual[];
}) {
  return (
    <div className="space-y-6 compact-chrome:space-y-4">
      <PageHeader
        eyebrow="화면 설명서"
        title={manual.title}
        description={
          <span className="break-keep">
            <HelpText text={manual.summary} currentSlug={manual.slug} />
          </span>
        }
        embedLabel={manual.title}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            <WindowLink
              href="/help"
              className="text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded-md px-1.5 text-sm font-medium"
            >
              <EyIcon name="arrowRight" size={14} className="rotate-180" />
              도움말
            </WindowLink>
            {manual.href !== "/help" ? <OpenScreen href={manual.href} label={manual.title} /> : null}
          </div>
        }
      />

      <GuideBlock
        title={manual.title}
        layout={manual.layout}
        callouts={manual.callouts}
        currentSlug={manual.slug}
      />

      {manual.faces?.map((face) => (
        <section key={face.title} className="space-y-2">
          <h2 className="text-foreground text-lg font-bold">{face.title}</h2>
          <p className="text-text-dim text-sm leading-relaxed break-keep">
            <HelpText text={face.summary} currentSlug={manual.slug} />
          </p>
          {face.callouts.length > 0 ? (
            <GuideBlock
              title={`${manual.title} · ${face.title}`}
              layout={manual.layout}
              callouts={face.callouts}
              currentSlug={manual.slug}
            />
          ) : null}
        </section>
      ))}

      {related.length > 0 ? (
        <section>
          <h2 className="text-foreground mb-2 text-sm font-bold">함께 보면 좋은 설명서</h2>
          <ul className="flex flex-wrap gap-2">
            {related.map((r) => (
              <li key={r.slug}>
                <WindowLink
                  href={`/help/${r.slug}`}
                  className="bg-primary-soft text-primary inline-flex h-(--control-h) items-center rounded-md px-2 text-sm font-medium"
                >
                  {r.title}
                </WindowLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
