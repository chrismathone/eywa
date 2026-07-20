import Image from "next/image";
import type { ComponentType, ReactNode } from "react";

import { EMPTY_STATE_IMAGES, type EmptyStateImage } from "@/components/empty-state-assets";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<{ className?: string; size?: number }>;

export type { EmptyStateImage } from "@/components/empty-state-assets";

export function EmptyState({
  icon: Icon,
  image,
  imageLoading = "lazy",
  title,
  description,
  action,
}: {
  icon?: IconComponent;
  image?: EmptyStateImage;
  imageLoading?: "eager" | "lazy";
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-line/80 bg-card text-foreground flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed text-center",
        image ? "gap-2 px-5 py-10" : "gap-3 py-12",
      )}
    >
      {image ? (
        <Image
          src={EMPTY_STATE_IMAGES[image]}
          alt=""
          width={640}
          height={640}
          sizes="(min-width: 640px) 160px, 144px"
          loading={imageLoading}
          className="mb-1 size-36 object-contain drop-shadow-[0_8px_10px_rgba(29,29,31,0.14)] sm:size-40"
        />
      ) : Icon ? (
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
