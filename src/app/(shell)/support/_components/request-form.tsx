"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MenuMentionEditor } from "@/components/editor/menu-mention-editor";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { createSupportRequest, updateSupportRequest } from "@/features/support/server/actions";

const INPUT = "border-line mt-1 h-(--control-h) w-full rounded-lg border px-3 text-sm";

/**
 * 개선요청 작성·수정 폼 — makeedu 글쓰기(제목 · 담당자 연락처 · 담당자 이메일 · 내용)와 같은 칸.
 * 연락처·이메일은 **결과를 받을 곳**이라 비워도 된다(답변은 aywa 벨과 이 글에도 남는다).
 */
export function SupportRequestForm({
  initial,
  requestId,
  onCancel,
}: {
  initial: { title: string; body: string; contactPhone: string; contactEmail: string };
  /** 있으면 수정. */
  requestId?: string;
  onCancel?: () => void;
}) {
  const embed = useEmbed();
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      className="bg-card shadow-card space-y-3 rounded-2xl p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = requestId ? await updateSupportRequest(requestId, form) : await createSupportRequest(form);
          if ("error" in res) {
            setError(res.error);
            return;
          }
          if (requestId) {
            onCancel?.();
            router.refresh();
            return;
          }
          // 서버 액션 직후 router.push는 삼켜진다([[#102]]) — 하드 이동.
          const href = `/support/requests/${res.id}`;
          window.location.assign(embed ? withEmbed(href) : href);
        });
      }}
    >
      <label className="block">
        <span className="text-sm font-bold">제목</span>
        <input value={form.title} onChange={set("title")} maxLength={120} required className={INPUT} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-bold">담당자 연락처</span>
          <input
            value={form.contactPhone}
            onChange={set("contactPhone")}
            maxLength={40}
            inputMode="tel"
            placeholder="결과를 받을 번호(선택)"
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold">담당자 이메일</span>
          <input
            type="email"
            value={form.contactEmail}
            onChange={set("contactEmail")}
            maxLength={200}
            placeholder="결과를 받을 이메일(선택)"
            className={INPUT}
          />
        </label>
      </div>
      <div className="block">
        <span className="text-sm font-bold">내용</span>
        <MenuMentionEditor defaultValue={initial.body} onChange={(body) => setForm((f) => ({ ...f, body }))} maxLength={8000} minHeight={220} placeholder="어느 화면에서, 무엇을, 어떻게 바꾸면 좋을지 적어 주세요. @로 메뉴를 선택하세요." />
      </div>
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : requestId ? "저장" : "등록"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            취소
          </Button>
        ) : null}
      </div>
    </form>
  );
}
