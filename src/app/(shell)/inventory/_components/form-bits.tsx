"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * 재고관리 다이얼로그 공용 부품 — 입력 클래스 한 벌 + 껍데기 + 제출 훅.
 *
 * 입력 글씨는 **폰 16px**(iOS는 16px 미만 입력에 포커스하면 화면을 자동 확대하고 되돌리지 않는다) /
 * 데스크톱 12.5px. 높이는 공용 `<Input>`과 같은 h-8.
 */
export const FIELD =
  "border-line focus:border-primary h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 text-base outline-none sm:text-xs disabled:opacity-60";
export const SELECT = `${FIELD} pr-7`;
export const TEXTAREA =
  "border-line focus:border-primary min-h-16 w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-base outline-none sm:text-xs";

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
  /** 안에 또 다른 `<label>`(체크박스 등)이 들어가면 `div` — 라벨 중첩은 무효 HTML이다. */
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
    <p role="alert" className="bg-danger-soft/40 text-danger rounded-lg px-3 py-1.5 text-xs">
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
  wide = false,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className={`max-h-[88vh] overflow-y-auto ${wide ? "sm:max-w-lg" : "sm:max-w-md"}`}>
        <DialogHeader>
          <DialogTitle className="text-base font-bold">{title}</DialogTitle>
          {description ? <DialogDescription className="text-xs">{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

type ActionResult = { ok?: true; error?: string } | undefined;

/**
 * 서버 액션 제출 — 성공하면 `router.refresh()`(서버 컴포넌트 재조회)·토스트, 실패면 폼 안 오류.
 * 결과를 그대로 돌려주므로 호출부가 추가 필드(실사의 `suggestLost`)를 읽을 수 있다.
 */
export function useSubmit() {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit<R extends ActionResult>(fd: FormData, action: (fd: FormData) => Promise<R>, successMessage?: string): Promise<R | undefined> {
    setError(null);
    return new Promise((resolve) => {
      startTransition(async () => {
        const res = await action(fd);
        if (res?.error) {
          setError(res.error);
          resolve(undefined);
          return;
        }
        if (successMessage) toast.success(successMessage);
        router.refresh();
        resolve(res);
      });
    });
  }

  return { busy, error, setError, submit };
}
