type Crumb = { label: string };

export function SuperAdminHeader({
  title,
  breadcrumb,
  action,
}: {
  title: string;
  breadcrumb: Crumb[];
  action?: React.ReactNode;
}) {
  const trail = ["AYWA", "SuperAdmin", ...breadcrumb.map((c) => c.label)].join(" · ");
  return (
    <header className="bg-background border-line sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b px-7">
      <div className="min-w-0">
        <div className="text-gold font-mono text-xs tracking-[1px] uppercase">{trail}</div>
        <h1 className="text-foreground mt-0.5 truncate text-xl leading-none font-bold tracking-tight">
          {title}
        </h1>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}
