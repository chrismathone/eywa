"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/observability/report-error";

/**
 * 셸 라우트 오류 경계 — **화면이 검게 죽지 않게** 한다.
 *
 * 왜 필요한가([[#109]]): eywa는 메뉴가 곧 창(iframe)이라, 서버 컴포넌트가 throw하면 그 창이 통째로
 * 빈 화면이 되고 사용자에겐 **단서가 0**이다. 앱 전체에 error.tsx가 하나도 없어서, 조회 실패를
 * `?? []`로 삼켜 "등록된 학생이 없습니다"라는 **거짓말**로 바꾸는 편이 그나마 나아 보였다.
 * 이 경계가 생기면 그 반대가 성립한다 — 실패는 실패라고 말하고, 사람이 다시 시도할 수 있다.
 *
 * 🔴 **원문을 화면에 그대로 쓰지 않는다**(CLAUDE.md "raw 코드·기술 원문 노출 금지").
 *    프로덕션에서 Next는 서버 오류 메시지를 지우고 `digest`만 남기므로 어차피 원문도 안 온다.
 *    digest는 Vercel 함수 로그에서 그 오류를 찾는 **열쇠**라 작게 남기고, 개발 중에만 잡히는
 *    메시지는 `title` 툴팁으로 둔다(classnote-error 선례와 같은 규약).
 *
 * ⚠️ 이 경계는 **자식 세그먼트**의 오류만 잡는다 — `(shell)/layout.tsx` 자체가 던지면 못 잡으므로
 *    그건 `app/global-error.tsx`가 받는다.
 */
export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 조용히 죽지 않게 — 구조화 로그 한 줄로 Vercel 함수 로그에서 scope로 찾는다.
    reportError(error, { scope: "shell.errorBoundary", digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[280px] items-center justify-center py-10">
      <div className="border-line/80 bg-card w-full max-w-md rounded-2xl border border-dashed px-6 py-10 text-center">
        <p className="text-base font-bold">화면을 불러오지 못했습니다</p>
        <p className="text-text-dim mt-2 text-sm" title={error.message || undefined}>
          잠시 뒤 다시 시도해 주세요. 계속 같은 화면이 나오면 원장님께 알려 주세요.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button onClick={() => reset()}>다시 시도</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            새로고침
          </Button>
        </div>
        {error.digest ? (
          <p className="text-text-faint num mt-4 text-[11px]">오류 번호 {error.digest}</p>
        ) : null}
      </div>
    </div>
  );
}
