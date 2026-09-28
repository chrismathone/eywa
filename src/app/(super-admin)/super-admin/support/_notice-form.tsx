"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteSupportNotice, saveSupportNotice } from "@/features/support/server/admin-actions";

/** 공지 작성·수정 — 제목 · 내용 · 상단 고정. 저장·삭제 뒤엔 목록으로 하드 이동([[#102]]). */
export function SupportNoticeForm({
  noticeId,
  initial,
}: {
  noticeId: string | null;
  initial: { title: string; body: string; pinned: boolean };
}) {
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [pinned, setPinned] = useState(initial.pinned);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toList = () => window.location.assign("/super-admin/support/notices");

  return (
    <form
      className="bg-card shadow-card space-y-4 rounded-2xl p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await saveSupportNotice(noticeId, { title, body, pinned });
          if ("error" in res) setError(res.error);
          else toList();
        });
      }}
    >
      <label className="block">
        <span className="text-sm font-bold">제목</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
          className="border-line mt-1 h-(--control-h) w-full rounded-lg border px-3 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-sm font-bold">내용</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={20000}
          required
          rows={16}
          className="border-line mt-1 w-full rounded-lg border px-3 py-2 text-sm leading-relaxed"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="size-4" />
        목록 맨 위에 고정(공지)
      </label>
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : noticeId ? "저장" : "등록"}
        </Button>
        {noticeId ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("이 공지를 지울까요? 모든 지점에서 사라지고 되돌릴 수 없습니다.")) return;
              setError(null);
              start(async () => {
                const res = await deleteSupportNotice(noticeId);
                if ("error" in res) setError(res.error);
                else toList();
              });
            }}
          >
            공지 삭제
          </Button>
        ) : null}
      </div>
    </form>
  );
}
