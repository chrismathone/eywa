import Image from "next/image";
import type { ComponentType, ReactNode } from "react";

import { EMPTY_STATE_IMAGES, type EmptyStateImage } from "@/components/empty-state-assets";
import { cn } from "@/lib/utils";
import { SheetText } from "@/features/teacher-view/interface-label";

type IconComponent = ComponentType<{ className?: string; size?: number }>;

export type { EmptyStateImage } from "@/components/empty-state-assets";

export function EmptyState({
  icon: Icon,
  image,
  imageLoading = "lazy",
  title,
  description,
  action,
  compact = false,
}: {
  icon?: IconComponent;
  image?: EmptyStateImage;
  imageLoading?: "eager" | "lazy";
  title: string;
  description?: string;
  action?: ReactNode;
  /** 업무 창에서 목록의 빈 상태가 화면 전체를 차지하지 않게 한다. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-line/80 bg-card text-foreground flex flex-col items-center justify-center rounded-xl border border-dashed text-center",
        compact ? "min-h-[160px] gap-2 px-4 py-4" : image ? "min-h-[280px] gap-2 px-5 py-10" : "min-h-[280px] gap-3 py-12",
      )}
    >
      {image ? (
        <Image
          src={EMPTY_STATE_IMAGES[image]}
          alt=""
          width={640}
          height={640}
          sizes={compact ? "72px" : "(min-width: 640px) 160px, 144px"}
          loading={imageLoading}
          className={cn("mb-1 object-contain", compact ? "size-18" : "size-36 sm:size-40")}
        />
      ) : Icon ? (
        <div className="bg-bg-soft text-text-dim rounded-full p-3">
          <Icon className="size-6" />
        </div>
      ) : null}
      <p className="text-base font-bold"><SheetText value={title} /></p>
      {description ? <p className="text-text-dim max-w-sm text-sm"><SheetText value={description} /></p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
