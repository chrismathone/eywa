"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { issueVideoSubmitLink, revokeVideoSubmitLinks } from "@/features/video-submit/server/actions";
import { formatShortKoreanDate } from "@/lib/date-kst";

type Issued = Awaited<ReturnType<typeof issueVideoSubmitLink>>;

/**
 * 반 한 줄의 '제출 링크 복사' · '링크 끊기'. 복사 = 누를 때마다 **새 7일 링크**(만든 날 + 7일).
 * 🔑 Safari는 await 뒤 클립보드 쓰기를 막는다 — 누르는 순간 `ClipboardItem`에 "곧 올 주소"를 약속으로 넘긴다.
 *    그래도 못 쓰면 주소를 화면에 보여 손으로 복사하게 한다(링크는 이미 만들어졌다).
 */
export function HomeworkVideoLinkButtons(props: { studentId: string; classId: string; classLabel: string; hasActive: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState<string | null>(null);

  async function copy() {
    setMessage(null);
    setManualUrl(null);
    let issued: Issued | null = null;
    const urlPromise = issueVideoSubmitLink(props.studentId, props.classId).then((result) => {
      issued = result;
      if (!result.ok) throw new Error(result.error);
      return result.url;
    });
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": urlPromise.then((url) => new Blob([url], { type: "text/plain" })) })]);
      } else {
        await navigator.clipboard.writeText(await urlPromise);
      }
      const done = issued as Issued | null;
      setMessage(done?.ok ? `복사했습니다 — ${formatShortKoreanDate(done.lastDay)}까지 쓸 수 있습니다.` : "복사했습니다.");
    } catch {
      await urlPromise.catch(() => undefined);
      const done = issued as Issued | null;
      if (done?.ok) {
        setManualUrl(done.url);
        setMessage("자동 복사가 막혔습니다. 아래 주소를 길게 눌러 복사해 주세요.");
      } else {
        setMessage(done && !done.ok ? done.error : "제출 링크를 만들지 못했습니다.");
      }
    }
    router.refresh();
  }

  function revoke() {
    if (!window.confirm(`${props.classLabel} 제출 링크를 모두 끊을까요? 이미 보낸 링크로는 더 이상 올릴 수 없습니다.`)) return;
    startTransition(async () => {
      const result = await revokeVideoSubmitLinks(props.studentId, props.classId);
      setManualUrl(null);
      setMessage(result.ok ? `링크 ${result.revoked}개를 끊었습니다.` : result.error);
      router.refresh();
    });
  }

  return (
    <div className="flex basis-full flex-col items-end gap-1 sm:basis-auto">
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => startTransition(copy)}>제출 링크 복사</Button>
        {props.hasActive ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={revoke}>링크 끊기</Button> : null}
      </div>
      {message ? <p className="text-text-dim text-xs break-keep" aria-live="polite">{message}</p> : null}
      {manualUrl ? <input readOnly value={manualUrl} onFocus={(event) => event.currentTarget.select()} aria-label="제출 링크 주소"
        className="border-line w-full rounded-lg border px-2 py-1 text-xs" /> : null}
    </div>
  );
}
