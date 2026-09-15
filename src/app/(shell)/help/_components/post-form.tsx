"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { createHelpPost, updateHelpPost } from "@/features/help/board/server/actions";

export function HelpPostForm({
  post,
}: {
  post?: { id: string; title: string; body: string };
}) {
  const embed = useEmbed();
  const router = useRouter();
  const editing = Boolean(post);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(post?.title ?? "");
  const [body, setBody] = useState(post?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button type="button" variant={editing ? "ghost" : "default"} onClick={() => setOpen(true)}>
        {editing ? "수정" : "질문하기"}
      </Button>
    );
  }

  return (
    <form
      className="bg-card shadow-card space-y-3 rounded-2xl p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = post
            ? await updateHelpPost(post.id, { title, body })
            : await createHelpPost({ title, body });
          if ("error" in res) {
            setError(res.error);
            return;
          }
          setOpen(false);
          if (post) {
            router.refresh();
            return;
          }
          setTitle("");
          setBody("");
          const href = `/help/posts/${res.id}`;
          window.location.assign(embed ? withEmbed(href) : href);
        });
      }}
    >
      <label className="block">
        <span className="text-sm font-bold">제목</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          required
          className="border-line mt-1 h-(--control-h) w-full rounded-lg border px-3 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-sm font-bold">내용</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          required
          rows={5}
          className="border-line mt-1 w-full rounded-lg border px-3 py-2 text-sm"
        />
      </label>
      {error ? (
        <p className="text-danger text-sm" title={error}>
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : editing ? "저장" : "올리기"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          취소
        </Button>
      </div>
    </form>
  );
}
