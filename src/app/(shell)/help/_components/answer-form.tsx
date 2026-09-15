"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { closeHelpPost, createHelpAnswer } from "@/features/help/board/server/actions";

export function HelpAnswerForm({ postId }: { postId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await createHelpAnswer(postId, body);
          if ("error" in res) {
            setError(res.error);
            return;
          }
          setBody("");
          router.refresh();
        });
      }}
    >
      <label className="block">
        <span className="text-sm font-bold">답변</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          required
          rows={4}
          className="border-line mt-1 w-full rounded-lg border px-3 py-2 text-sm"
        />
      </label>
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "올리는 중…" : "답변 올리기"}
      </Button>
    </form>
  );
}

export function HelpCloseButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await closeHelpPost(postId);
          if ("ok" in res) router.refresh();
        })
      }
    >
      글 닫기
    </Button>
  );
}
