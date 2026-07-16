import Image from "next/image";
import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

type IconComponent = ComponentType<{ className?: string; size?: number }>;

const EMPTY_STATE_IMAGES = {
  attendance: "/empty-states/empty-attendance.png",
  audit: "/empty-states/empty-audit.png",
  billing: "/empty-states/empty-billing.png",
  classes: "/empty-states/empty-classes.png",
  documents: "/empty-states/empty-documents.png",
  enrollment: "/empty-states/empty-enrollment.png",
  exams: "/empty-states/empty-exams.png",
  leaves: "/empty-states/empty-leaves.png",
  meetings: "/empty-states/empty-meetings.png",
  search: "/empty-states/empty-search.png",
  sends: "/empty-states/empty-sends.png",
  staff: "/empty-states/empty-staff.png",
  students: "/empty-states/empty-students.png",
  withdrawals: "/empty-states/empty-withdrawals.png",
  workspace: "/empty-states/empty-workspace.png",
} as const;

export type EmptyStateImage = keyof typeof EMPTY_STATE_IMAGES;

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
          width={220}
          height={220}
          loading={imageLoading}
          className="mb-1 size-36 object-contain sm:size-40"
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
