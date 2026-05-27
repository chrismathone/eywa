import type { ComponentType, ReactNode } from "react";

type IconComponent = ComponentType<{ className?: string; size?: number }>;

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: IconComponent;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-line/80 bg-card text-foreground flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed py-12 text-center">
      {Icon ? (
        <div className="bg-bg-soft text-text-dim rounded-full p-3">
          <Icon className="size-6" />
        </div>
      ) : null}
      <p className="text-base font-bold">{title}</p>
      {description ? <p className="text-text-dim max-w-sm text-sm">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
