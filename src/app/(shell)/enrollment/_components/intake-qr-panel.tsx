"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Copy, Loader2, Power, QrCode, Trash2, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
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

function Dialog({ tokens, onClose }: { tokens: IntakeTokenView[]; onClose: () => void }) {
  const router = useRouter();
  const [state, formAction] = useActionState<IntakeTokenState, FormData>(createIntakeToken, undefined);
  const [, startMutate] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const mutate = (fd: FormData) =>
    startMutate(async () => {
      await setIntakeTokenActive(undefined, fd);
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
      <div className="bg-background border-border my-8 w-full max-w-lg rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-foreground inline-flex items-center gap-1.5 text-lg font-semibold">
              <QrCode className="text-primary size-5" />
              학부모 공개 접수 QR
            </h2>
            <p className="text-text-dim mt-0.5 text-xs">
              QR/링크를 공유하면 학부모가 직접 상담을 신청합니다. 접수건은 등록상담에 ‘대기·QR 접수’로 들어옵니다.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="text-text-dim hover:text-foreground">
            <X className="size-4" />
          </button>
        </header>

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
                    <p className="text-foreground truncate text-sm font-semibold">{t.name}</p>
                    {!t.isActive ? <span className="text-text-faint text-[10px]">(비활성)</span> : null}
                  </div>
                  <p className="text-text-faint break-all font-mono text-[10px]">{t.url}</p>
                  <p className="text-text-dim text-[11px]">
                    조회 <span className="num">{t.usageCount}</span> · 제출{" "}
                    <span className="text-primary num font-bold">{t.submissionCount}</span>
                    {t.expiresAt ? ` · ~${t.expiresAt.slice(0, 10)}` : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => copy(t.url, t.id)}
                      className="border-border text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]"
                    >
                      <Copy className="size-3" />
                      {copied === t.id ? "복사됨" : "링크 복사"}
                    </button>
                    <form action={mutate}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="action" value="toggle" />
                      <input type="hidden" name="active" value={String(!t.isActive)} />
                      <button
                        type="submit"
                        className="border-border text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]"
                      >
                        <Power className="size-3" />
                        {t.isActive ? "비활성" : "활성"}
                      </button>
                    </form>
                    <form action={mutate}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="action" value="delete" />
                      <button
                        type="submit"
                        className="text-danger/70 hover:text-danger inline-flex items-center gap-1 rounded border border-transparent px-2 py-0.5 text-[11px]"
                      >
                        <Trash2 className="size-3" />
                        삭제
                      </button>
                    </form>
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
export function IntakeQrButton({ tokens }: { tokens: IntakeTokenView[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <QrCode className="size-4" />
        공개 접수 QR
      </Button>
      {open ? <Dialog tokens={tokens} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
