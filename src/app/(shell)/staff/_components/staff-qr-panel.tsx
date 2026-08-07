"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Loader2, Power, QrCode, RefreshCw, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import type { StaffQrView } from "@/features/staff/intake-view";
import {
  ensureStaffIntakeToken,
  updateStaffIntakeToken,
} from "@/features/staff/server/intake-token-actions";

/**
 * 직원 등록 QR — **입력칸 없이 QR 하나**(원장 지시 2026-08-07 재확인: "채용 이름·역할·유효일을 정해서
 * 만드는 게 아니라, 직원 명부 쓰는 창이 나오면 되는 것"). 버튼을 누르면 있는 QR을 보여주고, 없으면
 * 그 자리에서 만든다(역할=강사 고정, 만료 없음 — intake-token-actions 상단 주석).
 *
 * 찍은 사람은 /staff-intake/[token]에서 **직원 명부를 그대로 작성**하고, 제출 즉시 계정이 만들어진다.
 * ⚠️ 링크를 아는 사람은 로그인 없이 계정을 만든다 — 다 쓰면 '닫기', 새어 나갔으면 '새 링크'.
 */
export function StaffQrPanel({ tokens }: { tokens: StaffQrView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [made, setMade] = useState<StaffQrView | null>(null);
  const [pending, start] = useTransition();

  // 서버가 준 목록(열린 것 우선) → 액션이 돌려준 최신 뷰가 있으면 그것이 진실.
  const view = made ?? tokens.find((t) => t.open) ?? tokens[0] ?? null;
  const others = tokens.filter((t) => t.id !== view?.id && t.open);

  function toggle() {
    const next = !open;
    setOpen(next);
    // 처음 여는 학원이면 여기서 QR이 생긴다 — 물어볼 게 없으니 묻지 않는다.
    if (next && !view && !pending) {
      start(async () => {
        const res = await ensureStaffIntakeToken();
        if (res?.error) toast.error(res.error);
        else if (res?.view) setMade(res.view);
      });
    }
  }

  function mutate(action: "close" | "reopen" | "rotate" | "closeOthers") {
    if (!view) return;
    start(async () => {
      const fd = new FormData();
      fd.set("id", view.id);
      fd.set("action", action);
      const res = await updateStaffIntakeToken(undefined, fd);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(res?.notice ?? "저장했습니다");
      if (res?.view) setMade(res.view);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={toggle} aria-expanded={open}>
        <QrCode className="size-3.5" />
        등록 QR
      </Button>

      {open ? (
        <div className="bg-card fixed inset-x-3 top-16 z-50 mx-auto max-w-sm rounded-2xl p-5 shadow-modal sm:inset-x-auto sm:right-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-foreground text-sm font-bold">직원 등록 QR</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="닫기"
              className="text-text-dim"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="text-text-dim mb-4 text-[12px] leading-relaxed">
            이 QR을 찍으면 <b>직원 명부 작성 화면</b>이 열립니다. 제출하면 {view?.roleLabel ?? "강사"} 계정이
            바로 만들어집니다(초기 비밀번호 eywa123). 역할·부서는 등록 뒤 직원 상세에서 바꿀 수 있습니다.
          </p>

          {!view ? (
            <p className="text-text-dim flex items-center justify-center gap-2 py-10 text-[13px]">
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> QR을 만드는 중…
                </>
              ) : (
                "QR을 불러오지 못했습니다"
              )}
            </p>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span
                className={`w-48 [&>svg]:size-full ${view.open ? "" : "opacity-25"}`}
                // QR은 서버가 만든 SVG 문자열(qrcode 라이브러리) — 사용자 입력이 아니다.
                dangerouslySetInnerHTML={{ __html: view.qrSvg }}
              />
              {view.open ? (
                <>
                  <span className="text-text-faint break-all text-center text-[10px]">{view.url}</span>
                  <span className="text-text-dim text-[11px]">
                    등록 <span className="num text-foreground font-bold">{view.submissionCount}</span>명
                    {view.expiresAt ? (
                      <> · <span className="num">{view.expiresAt.slice(0, 10)}</span>까지</>
                    ) : null}
                  </span>
                </>
              ) : (
                <span className="text-text-dim text-[12px]">
                  닫혀 있습니다 — 지금은 이 QR로 등록할 수 없습니다
                </span>
              )}

              <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                {view.open ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(view.url);
                        toast.success("링크를 복사했습니다");
                      }}
                      className="border-line text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px]"
                    >
                      <Copy className="size-3" /> 링크 복사
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm("새 링크를 발급하면 지금 QR·링크는 더 이상 열리지 않습니다. 계속할까요?"))
                          mutate("rotate");
                      }}
                      className="border-line text-text-dim hover:text-foreground inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] disabled:opacity-50"
                    >
                      <RefreshCw className="size-3" /> 새 링크
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => mutate("close")}
                      className="border-line text-text-dim hover:text-danger inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] disabled:opacity-50"
                    >
                      <Power className="size-3" /> 닫기
                    </button>
                  </>
                ) : (
                  <Button size="sm" disabled={pending} onClick={() => mutate("reopen")}>
                    {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
                    다시 열기
                  </Button>
                )}
              </div>

              {others.length > 0 ? (
                <p className="text-text-faint mt-2 text-center text-[11px]">
                  예전에 만든 링크 <span className="num">{others.length}</span>개가 아직 열려 있습니다
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => mutate("closeOthers")}
                    className="text-danger ml-1.5 font-bold underline disabled:opacity-50"
                  >
                    모두 닫기
                  </button>
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
