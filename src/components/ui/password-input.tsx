"use client";

import * as React from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * 비밀번호 입력 — 우측 눈 아이콘으로 표시/숨김을 토글한다("내가 잘 쳤는지" 확인용).
 * 공용 shadcn `<Input>` 기반이라 일반 입력과 동일한 룩. `className`으로 컨텍스트별 스타일을 덮어쓸 수 있다.
 * ⚠️ `type`은 내부에서 password↔text로 토글하므로 넘기지 말 것.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className={cn("pr-9", className)} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        // 탭 순서에서 제외(비번 입력 후 Enter/다음 필드로 자연 이동, 눈은 마우스/명시 클릭으로만).
        tabIndex={-1}
        aria-label={show ? "비밀번호 숨기기" : "비밀번호 표시"}
        title={show ? "비밀번호 숨기기" : "비밀번호 표시"}
        className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex items-center px-2.5 transition-colors"
      >
        <EyIcon name={show ? "eyeOff" : "eye"} size={16} className="size-4" />
      </button>
    </div>
  );
}
