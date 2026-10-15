"use client";

import { useState, useTransition } from "react";
import { deleteParentAccount } from "../server/parent-actions";

/**
 * 학부모 계정 [삭제] — 누르면 카드 안에 **확인 칸**이 열리고, 한 번 더 눌러야 지운다.
 *
 * 🔑 브라우저 `confirm()`을 쓰지 않는다 — 창(iframe)·앱 안에서 막히거나 모양이 제각각이고, 무엇이
 *    지워지는지 적을 자리가 없다. 확인 칸이 **지워지는 것과 남는 것**을 함께 말한다.
 * 서버 액션이 원장·관리자 판정·학원 확인을 다시 본다(화면 조건은 게이트가 아니다, #77).
 */
export function ParentAccountDelete({ accountId, name, studentCount }: { accountId: string; name: string; studentCount: number }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteParentAccount(accountId);
      if (res.error) {
        setError(res.error);
        return;
      }
      // 성공하면 서버가 화면을 다시 그려 이 카드가 사라진다. 알림이 있으면 사라지기 전 잠깐 보인다.
      if (res.notice) setNotice(res.notice);
      setAsking(false);
    });
  }

  if (!asking) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setAsking(true);
          }}
          className="text-danger rounded-lg px-2 py-1 text-sm font-bold hover:bg-danger-soft"
        >
          삭제
        </button>
        {notice ? <p className="text-text-dim text-xs">{notice}</p> : null}
      </div>
    );
  }

  return (
    <div role="alertdialog" aria-label={`${name} 계정 삭제 확인`} className="border-danger/40 bg-danger-soft mt-3 w-full rounded-xl border p-3">
      <p className="text-danger font-bold">정말 삭제하겠습니까?</p>
      <ul className="text-foreground mt-1 list-disc pl-5 text-sm">
        <li>
          <b>{name}</b>의 로그인이 지워져 다시 로그인할 수 없습니다(열려 있는 로그인도 끊깁니다).
        </li>
        <li>연결된 원생 {studentCount}명과의 연결이 해제됩니다.</li>
        <li>원생 정보·셔틀 배정·탑승 기록은 그대로 남습니다.</li>
      </ul>
      <p className="text-text-dim mt-1 text-xs">되돌릴 수 없습니다 — 다시 쓰려면 새로 발급해야 합니다.</p>
      {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => setAsking(false)}
          className="border-line bg-card rounded-lg border px-3 py-1.5 text-sm font-bold disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={confirmDelete}
          className="bg-danger rounded-lg px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? "삭제 중..." : "삭제"}
        </button>
      </div>
    </div>
  );
}
