import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border/60 flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-12 text-center">
      {Icon ? (
        <div className="bg-muted text-muted-foreground rounded-full p-3">
          <Icon className="size-6" />
        </div>
      ) : null}
      <p className="text-base font-medium">{title}</p>
      {description ? <p className="text-muted-foreground max-w-sm text-sm">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
