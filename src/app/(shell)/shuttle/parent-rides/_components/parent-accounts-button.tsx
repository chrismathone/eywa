"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ParentAccountForm } from "@/features/shuttle/parent-accounts/components/parent-account-form";
import { ParentAccountList } from "@/features/shuttle/parent-accounts/components/parent-account-list";
import type { ParentAccount, ParentStudentOption } from "@/features/shuttle/parent-accounts/server/parents";

/**
 * '학부모 등하원' 오른쪽 [학부모 관리 현황] — 누르면 계정 목록 + 발급 폼이 **모달**로 뜬다.
 *
 * 🔴 원장·관리자 전용이다 — 페이지가 `parentAccountsActor()`로 판정한 뒤에만 이 부품과 데이터를 싣는다
 *    (다른 역할에겐 버튼도, 이메일·연락처 데이터도 내려가지 않는다). 발급 서버 액션도 같은 판정을 다시 본다.
 * 🔑 발급하면 서버 액션이 이 화면 경로도 재검증해 목록·'학부모 계정 연결' 표시가 곧바로 새 값으로 바뀐다.
 * ⚠️ 모달이 닫히면 내용이 언마운트된다 — 다시 열면 폼·안내 문구가 새로 시작한다(#67 재오픈 즉시닫힘 방지).
 */
export function ParentAccountsButton({
  accounts,
  students,
  readOnly = false,
}: {
  accounts: ParentAccount[];
  students: ParentStudentOption[];
  /** 읽기 강사뷰 · 지점 보기 — 목록만 보이고 발급 폼 · 삭제는 그리지 않는다(서버 액션도 같은 판정으로 거절). */
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className="shrink-0" onClick={() => setOpen(true)}>
        학부모 관리 현황
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="z-[90] max-h-[88vh] overflow-y-auto sm:max-w-5xl">
          {/* pr-10 — 오른쪽 위 닫기(×) 버튼 자리. 없으면 인원 배지가 ×와 겹친다. */}
          <div className="flex items-center justify-between gap-3 pr-10">
            <DialogTitle>학부모 관리 현황</DialogTitle>
            <span className="bg-bg-soft rounded-full px-3 py-1 text-sm font-bold">{accounts.length}명</span>
          </div>
          <DialogDescription>학부모 계정과 연결된 원생을 확인하고 새 계정을 발급합니다.</DialogDescription>
          <div className="mt-2 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
            <ParentAccountList accounts={accounts} readOnly={readOnly} />
            {readOnly ? null : <ParentAccountForm students={students} framed={false} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
