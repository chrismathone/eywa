"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Plus, QrCode, Trash2, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  createStaffIntakeToken,
  setStaffIntakeToken,
  type IntakeTokenActionState,
} from "@/features/staff/server/intake-token-actions";

export type StaffQrView = {
  id: string;
  name: string;
  url: string;
  qrSvg: string;
  active: boolean;
  open: boolean;
  roleLabel: string;
  submissionCount: number;
  expiresAt: string | null;
};

/**
 * 직원 등록 QR — 새로 만들기·열기/닫기·삭제 + QR 보기(원장 지시 2026-08-07).
 * ⚠️ 이 링크를 아는 사람은 **로그인 없이 직원 계정을 만든다**(원장이 '제출 즉시 생성'을 택함) —
 * 화면에 그 사실을 적어 두고, 다 쓰면 닫는 운영을 전제로 한다.
 */
export function StaffQrPanel({ tokens }: { tokens: StaffQrView[] }) {
  const [open, setOpen] = useState(false);
  const [showQr, setShowQr] = useState<string | null>(null);
  const [state, createAction] = useActionState<IntakeTokenActionState, FormData>(
    createStaffIntakeToken,
    undefined,
  );
  const [mutState, mutAction] = useActionState<IntakeTokenActionState, FormData>(
    setStaffIntakeToken,
    undefined,
  );
  const seen = useRef<IntakeTokenActionState>(undefined);
  const seenMut = useRef<IntakeTokenActionState>(undefined);
  useEffect(() => {
    for (const [s, ref] of [
      [state, seen],
      [mutState, seenMut],
    ] as const) {
      if (!s || s === ref.current) continue;
      ref.current = s;
      if (s.error) toast.error(s.error);
      else if (s.ok) toast.success(s.notice ?? "저장했습니다");
    }
  }, [state, mutState]);

  const mutate = (id: string, action: string, active?: boolean) => {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("action", action);
    if (active !== undefined) fd.set("active", String(active));
    startTransition(() => mutAction(fd));
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <QrCode className="size-3.5" />
        등록 QR
        {tokens.filter((t) => t.open).length > 0 ? (
          <span className="num text-primary">{tokens.filter((t) => t.open).length}</span>
        ) : null}
      </Button>

      {open ? (
        <div className="bg-card fixed inset-x-3 top-16 z-50 mx-auto max-w-lg rounded-2xl p-5 shadow-modal sm:inset-x-auto sm:right-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-foreground text-sm font-bold">직원 등록 QR</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="닫기" className="text-text-dim">
              <X className="size-4" />
            </button>
          </div>
          <p className="text-text-dim mb-3 text-[12px]">
            링크를 연 사람은 <b>직원 명부를 작성해 스스로 계정을 만듭니다</b>(초기 비밀번호 eywa123). 다 쓰면
            닫아 주세요.
          </p>

          <form action={createAction} className="border-line mb-3 flex flex-wrap items-end gap-2 border-b pb-3">
            <label className="flex-1">
              <span className="micro mb-1 block">이름</span>
              <input
                name="name"
                placeholder="예: 2026 상반기 채용"
                className="border-line bg-card w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
              />
            </label>
            <label>
              <span className="micro mb-1 block">역할</span>
              <select
                name="role"
                defaultValue="teacher"
                className="border-line bg-card rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
              >
                <option value="teacher">강사</option>
                <option value="viewer">참관</option>
              </select>
            </label>
            <label className="w-20">
              <span className="micro mb-1 block">유효(일)</span>
              <input
                name="days"
                type="number"
                min={1}
                max={365}
                defaultValue={90}
                className="border-line bg-card num w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
              />
            </label>
            <Button type="submit" size="sm">
              <Plus className="size-3.5" /> 만들기
            </Button>
          </form>

          {tokens.length === 0 ? (
            <p className="text-text-dim text-[13px]">아직 만든 QR이 없습니다.</p>
          ) : (
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
              {tokens.map((t) => (
                <li key={t.id} className="border-line rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="text-foreground text-[13px] font-bold">{t.name}</span>
                      <span className="text-text-dim ml-1.5 text-[11px]">
                        {t.roleLabel} · 등록 <span className="num">{t.submissionCount}</span>명
                        {t.expiresAt ? ` · ~${t.expiresAt.slice(0, 10)}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          t.open ? "bg-primary-soft text-primary" : "bg-bg-soft text-text-dim"
                        }`}
                      >
                        {t.open ? "열림" : t.active ? "만료" : "닫힘"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowQr(showQr === t.id ? null : t.id)}
                        className="text-text-dim hover:text-primary text-[11px] font-bold"
                      >
                        QR
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(t.url);
                          toast.success("링크를 복사했습니다");
                        }}
                        aria-label="링크 복사"
                        className="text-text-dim hover:text-primary"
                      >
                        <Copy className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => mutate(t.id, "toggle", !t.active)}
                        className="text-text-dim hover:text-primary text-[11px] font-bold"
                      >
                        {t.active ? "닫기" : "열기"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`'${t.name}' QR을 삭제할까요?`)) mutate(t.id, "delete");
                        }}
                        aria-label="삭제"
                        className="text-text-faint hover:text-danger"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  </div>
                  {showQr === t.id ? (
                    <div className="mt-2 flex flex-col items-center gap-1.5">
                      <span
                        className="w-40 [&>svg]:size-full"
                        // QR은 서버가 만든 SVG 문자열(qrcode 라이브러리) — 사용자 입력이 아니다.
                        dangerouslySetInnerHTML={{ __html: t.qrSvg }}
                      />
                      <span className="text-text-faint break-all text-[10px]">{t.url}</span>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </>
  );
}

/** 저장 중 표시용 — 서버 액션 전송 상태를 버튼에 반영할 때 쓴다(현재는 토스트로 충분해 미사용 대비). */
export function QrSpinner() {
  return <Loader2 className="size-3.5 animate-spin" />;
}
