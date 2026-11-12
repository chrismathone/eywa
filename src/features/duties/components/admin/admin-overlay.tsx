"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmbedAnchor } from "@/components/embed-link";
import { withEmbed } from "@/components/workspace/embed-context";
import type { DutyWork } from "../duty-work-context";

/**
 * 관리자 화면의 오버레이 창 = '간이 페이지'(학생 상세 · 상담 작성 · 반 상세 iframe · 원장 2026-11-09 *"누르면 왠만하면 전부 오버레이로"*) + '이 화면으로 이동 ›'.
 * 목록은 페이지 본문(단계별 보기)이 맡으므로 창 안엔 간이 페이지뿐이다. 여는 쪽이 열 때마다 새로 마운트한다(key).
 */
export function AdminOverlay({ work, onClose }: { work: DutyWork; onClose: () => void }) {
  return <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
    <DialogContent className="flex h-[min(900px,94dvh)] w-[min(96vw,1480px)] flex-col gap-3 sm:max-w-[min(96vw,1480px)]">
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <DialogTitle className="min-w-0 flex-1">{work.title}</DialogTitle>
          <EmbedAnchor href={work.href} className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-sm font-semibold hover:brightness-95">이 화면으로 이동 ›</EmbedAnchor>
        </div>
      </DialogHeader>
      <iframe key={work.href} src={withEmbed(work.href)} title={work.title} className="border-line min-h-0 w-full flex-1 rounded-xl border bg-background" />
    </DialogContent>
  </Dialog>;
}
