"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { deleteHelpPost } from "@/features/help/board/server/actions";

export function HelpDeleteButton({ postId }: { postId: string }) {
  const embed = useEmbed();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!confirm("이 질문을 지울까요?")) return;
        start(async () => {
          const res = await deleteHelpPost(postId);
          if ("ok" in res) window.location.assign(embed ? withEmbed("/help") : "/help");
        });
      }}
    >
      삭제
    </Button>
  );
}
