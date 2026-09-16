"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * 교재목록 다이얼로그 공용 부품 — 재고관리 `_components/form-bits.tsx`와 **같은 규약**이다
 * (입력 높이 h-8 · 폰 16px / 데스크톱 12.5px · 다이얼로그 껍데기 · 제출 훅).
 *
 * ⚠️ 폰에서 16px 미만 입력에 포커스하면 iOS가 화면을 자동 확대하고 되돌리지 않는다 — `text-base sm:text-xs`.
 */
export const FIELD =
  "border-line focus:border-primary h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 text-base outline-none sm:text-xs disabled:opacity-60";
export const SELECT = `${FIELD} pr-7`;

export function Field({
  label,
  children,
  hint,
  className = "",
  as = "label",
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
  /** 안에 또 다른 `<label>`이 들어가면 `div` — 라벨 중첩은 무효 HTML이다. */
  as?: "label" | "div";
}) {
  const Tag = as;
  return (
    <Tag className={`flex flex-col gap-1 ${className}`}>
      <span className="text-text-dim text-xs font-bold">{label}</span>
      {children}
      {hint ? <span className="text-text-faint text-xs">{hint}</span> : null}
    </Tag>
  );
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="border-danger bg-danger-soft/40 text-danger rounded-lg border-l-[3px] px-3 py-1.5 text-xs">
      {error}
    </p>
  );
}

/** 다이얼로그 껍데기 — 닫기는 오버레이·ESC·× 전부 `onClose`로 모은다. */
export function DialogShell({
  title,
  description,
  onClose,
  children,
  size = "md",
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  const w = size === "xl" ? "sm:max-w-3xl" : size === "lg" ? "sm:max-w-xl" : "sm:max-w-md";
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className={`max-h-[88vh] overflow-y-auto ${w}`}>
        <DialogHeader>
          <DialogTitle className="text-base font-bold">{title}</DialogTitle>
          {description ? <DialogDescription className="text-xs">{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

type ActionResult = { ok: boolean; error?: string } | { ok?: true; error?: string } | undefined;

/**
 * 서버 액션 호출 — 성공하면 `router.refresh()`(서버 컴포넌트 재조회) + 토스트, 실패면 폼 안 오류.
 * 결과를 그대로 돌려주므로 호출부가 추가 필드를 읽을 수 있다.
 */
export function useRun() {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run<R extends ActionResult>(action: () => Promise<R>, successMessage?: string): Promise<R | undefined> {
    setError(null);
    return new Promise((resolve) => {
      startTransition(async () => {
        let res: R;
        try {
          res = await action();
        } catch (e) {
          setError(e instanceof Error ? e.message : "처리하지 못했습니다");
          resolve(undefined);
          return;
        }
        if (!res || res.ok === false || res.error) {
          setError(res?.error ?? "처리하지 못했습니다");
          resolve(undefined);
          return;
        }
        if (successMessage) toast.success(successMessage);
        router.refresh();
        resolve(res);
      });
    });
  }

  return { busy, error, setError, run };
}
