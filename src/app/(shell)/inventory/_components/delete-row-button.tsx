"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSubmit } from "./form-bits";

/**
 * 재고관리 다이얼로그의 **삭제 버튼** — 네 면(자산·대여·실사·소모품)이 쓰는 한 벌.
 *
 * 원장 2026-09-08: *"실수로 등록했을때 삭제할 수 있도록 배선처리"* · *"더블클릭했을때 삭제 할 수 있도록
 * 우하단 버튼 마련"*.
 *
 * 🔴 **한 번 더 묻는다** — 삭제는 되돌릴 수 없고, 자산은 대여·실사 이력까지 함께 지운다(FK cascade).
 *    무엇이 함께 지워지는지는 `confirm`에 적어서 넘긴다(화면이 그 사실을 먼저 말한다).
 * 🔑 자리는 **하단 버튼 줄(우하단)의 맨 앞**이다(원장 2026-09-08 *"우하단 버튼 마련"*) — 줄은 오른쪽
 *    정렬이되 [삭제][취소][저장] 순이라 **[저장] 바로 옆에 오지 않는다**(오클릭이 곧 삭제가 되는 자리).
 * ⚠️ 서버 액션은 각 면이 넘긴다(이 부품은 게이트를 모른다) — 권한·거절 사유는 서버가 한글로 돌려준다.
 */
export function DeleteRowButton({
  id,
  action,
  label,
  confirm,
  successMessage,
  onDone,
}: {
  id: string;
  action: (fd: FormData) => Promise<{ ok?: true; error?: string } | undefined>;
  /** 확인창 제목 — "자산 NB-012 삭제"처럼 무엇을 지우는지 적는다. */
  label: string;
  /** 확인창 본문 — 함께 지워지는 것·되돌릴 수 없다는 사실. */
  confirm: string;
  successMessage: string;
  /** 성공하면 다이얼로그를 닫는다. */
  onDone: () => void;
}) {
  const { busy, error, submit } = useSubmit();
  const [asking, setAsking] = useState(false);

  async function run() {
    const fd = new FormData();
    fd.set("id", id);
    const res = await submit(fd, action, successMessage);
    setAsking(false);
    if (res) onDone();
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => setAsking(true)}
        className="text-danger border-danger/40 hover:bg-danger-soft"
      >
        삭제
      </Button>
      {/* 실패 사유는 확인창을 닫은 뒤에도 보여야 한다 — 폼 본문이 아니라 버튼 옆에 둔다. */}
      {error ? <span className="text-danger self-center text-[12px]">{error}</span> : null}
      <ConfirmDialog
        open={asking}
        title={label}
        message={confirm}
        confirmLabel="삭제"
        danger
        onConfirm={() => void run()}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}
