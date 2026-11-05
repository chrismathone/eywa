"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { kstDateOf } from "@/lib/date-kst";
import { isIntakeExpired } from "@/features/enrollment/intake-expiry";
import { Copy, Loader2, Power, QrCode, Trash2, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { writeLockedNote } from "@/lib/write-lock";
import {
  createIntakeToken,
  setIntakeTokenActive,
  type IntakeTokenState,
} from "@/features/enrollment/server/intake-actions";

export type IntakeTokenView = {
  id: string;
  name: string;
  url: string;
  qrSvg: string;
  isActive: boolean;
  usageCount: number;
  submissionCount: number;
  expiresAt: string | null;
};

function CreateBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
      링크 생성
    </Button>
  );
}

function Dialog({ tokens, canWrite, onClose }: { tokens: IntakeTokenView[]; canWrite: boolean; onClose: () => void }) {
  const router = useRouter();
  const [state, formAction] = useActionState<IntakeTokenState, FormData>(createIntakeToken, undefined);
  const [, startMutate] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const mutate = (fd: FormData) =>
    startMutate(async () => {
      const res = await setIntakeTokenActive(undefined, fd);
      // 실패를 삼키면 눌러도 무반응으로 보인다 — 사유를 띄운다.
      if (res?.error) toast.error(res.error);
      router.refresh();
    });

  async function copy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard 차단 환경 무시 */
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="bg-background border-border my-8 w-full max-w-lg rounded-xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-foreground inline-flex items-center gap-1.5 text-lg font-bold">
              <QrCode className="text-primary size-5" />
              학부모 공개 접수 QR
            </h2>
            <p className="text-text-dim mt-0.5 text-xs">
              QR/링크를 공유하면 학부모가 직접 상담을 신청합니다. 접수건은 신규 콜&상담에 ‘대기·QR 접수’로 들어옵니다.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="text-text-dim hover:text-foreground">
            <X className="size-4" />
          </button>
        </header>

        {/* 🔴 읽기 권한이면 링크 생성 양식째 그리지 않는다 — QR 보기·링크 복사만 남는다(원장 2026-11-05 · write-lock.ts).
            서버(requireIntakeAdmin)도 같은 판정(enrollment full|scoped)으로 다시 막는다. */}
        {canWrite ? (
        <form action={formAction} className="border-border mb-4 flex flex-wrap items-end gap-2 border-b pb-4">
          <label className="flex-1 space-y-1">
            <span className="text-foreground block text-xs font-medium">링크 이름</span>
            <input
              name="name"
              placeholder="예: 2026 봄 입학설명회"
              className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="text-foreground block text-xs font-medium">만료일(선택)</span>
            <input
              name="expiresAt"
              type="date"
              className="border-border bg-card text-foreground num rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <CreateBtn />
        </form>
        ) : (
          <p className="text-text-dim border-border mb-4 border-b pb-4 text-xs">{writeLockedNote("enrollment")}</p>
        )}
        {state?.error ? <p className="text-danger mb-3 text-xs">{state.error}</p> : null}

        {tokens.length === 0 ? (
          <p className="text-text-faint border-border rounded-md border border-dashed px-4 py-8 text-center text-sm">
            아직 생성된 접수 링크가 없습니다.
          </p>
        ) : (
          <ul className="space-y-3">
            {tokens.map((t) => (
              <li
                key={t.id}
                className={`border-border flex gap-3 rounded-lg border p-3 ${t.isActive ? "" : "opacity-60"}`}
              >
                <div
                  className="size-24 shrink-0 [&_svg]:size-full"
                  dangerouslySetInnerHTML={{ __html: t.qrSvg }}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-foreground truncate text-sm font-bold">{t.name}</p>
                    {!t.isActive ? <span className="text-text-faint text-xs">(비활성)</span> : null}
                    {t.isActive && isIntakeExpired(t.expiresAt) ? (
                      <span className="text-danger text-xs">(만료 — 접수 안 됨)</span>
                    ) : null}
                  </div>
                  <p className="text-text-faint break-all font-mono text-xs">{t.url}</p>
                  <p className="text-text-dim text-xs">
                    조회 <span className="num">{t.usageCount}</span> · 제출{" "}
                    <span className="text-primary num font-bold">{t.submissionCount}</span>
                    {/* 만료일은 KST 날짜로 — 그날 밤 23:59까지 접수된다(감사 F14). */}
                    {t.expiresAt ? ` · ~${kstDateOf(t.expiresAt) ?? ""}까지` : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => copy(t.url, t.id)}
                      className="border-border text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs"
                    >
                      <Copy className="size-3" />
                      {copied === t.id ? "복사됨" : "링크 복사"}
                    </button>
                    {/* 활성 토글·만료일 변경·삭제 = 쓰기 — 읽기 권한이면 그리지 않는다(링크 복사만). */}
                    {canWrite ? (
                    <>
                    <form action={mutate}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="action" value="toggle" />
                      <input type="hidden" name="active" value={String(!t.isActive)} />
                      <button
                        type="submit"
                        className="border-border text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs"
                      >
                        <Power className="size-3" />
                        {t.isActive ? "비활성" : "활성"}
                      </button>
                    </form>
                    {/* 만료일 변경(연장) — 만료된 QR도 새로 인쇄하지 않고 되살린다(감사 F14). */}
                    <form action={mutate} className="inline-flex items-center gap-1">
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="action" value="expire" />
                      <input
                        name="expiresAt"
                        type="date"
                        required
                        aria-label="새 만료일"
                        defaultValue={t.expiresAt ? (kstDateOf(t.expiresAt) ?? "") : ""}
                        className="border-border bg-card text-foreground num rounded border px-1.5 py-0.5 text-xs"
                      />
                      <button
                        type="submit"
                        className="border-border text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs"
                      >
                        만료일 변경
                      </button>
                    </form>
                    <form action={mutate}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="action" value="delete" />
                      <button
                        type="submit"
                        className="text-danger/70 hover:text-danger inline-flex items-center gap-1 rounded border border-transparent px-2 py-0.5 text-xs"
                      >
                        <Trash2 className="size-3" />
                        삭제
                      </button>
                    </form>
                    </>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 등록상담 헤더의 "공개 접수 QR" 트리거. */
export function IntakeQrButton({ tokens, canWrite = true }: { tokens: IntakeTokenView[]; canWrite?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* 우상단 액션은 공용 Button **기본 크기**로 통일(원장 2026-09-01 *"우상단 버튼크기 통일"*) —
          옆 '신규 등록'이 기본 크기라 여기만 sm이면 두 버튼 키가 다르다.
          지시서 §10(원장 2026-09-03 "지시서 그대로"): 면 버튼은 창당 Primary 하나('신규 등록상담') — 이건 보더 없는 텍스트. */}
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <QrCode className="size-4" />
        공개 접수 QR
      </Button>
      {open ? <Dialog tokens={tokens} canWrite={canWrite} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
