"use client";

import { useCallback, useState } from "react";
import { CheckCircle2 } from "@/components/icons/aywa-icon-compat";
import { ResumeSheet } from "@/app/(shell)/staff/resumes/_components/resume-sheet";
import { submitPublicStaffIntake } from "@/features/staff/intake/server/public-intake-actions";
import type { StaffResumeData } from "@/features/staff/resume/resume";

/**
 * 직원 등록 QR 공개 폼(원장 지시 2026-08-07) — 서식은 **직원 명부 그대로**(ResumeSheet 재사용,
 * 액션만 공개용으로 주입). 칸을 복제하지 않는 이유는 resume-sheet의 주석 참조(70칸 이상, 갈라지면 어긋난다).
 * 제출에 성공하면 바로 계정이 만들어지고(원장 결정), 여기서 아이디·초기 비밀번호를 알려준다.
 */
export function PublicStaffForm({
  data,
  token,
  academyName,
}: {
  data: StaffResumeData;
  token: string;
  academyName: string;
}) {
  const [done, setDone] = useState<{ email: string; password: string } | null>(null);

  const onSaved = useCallback((state: { notice?: string }) => {
    const [email = "", password = ""] = String(state.notice ?? "").split("|");
    setDone({ email, password });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  if (done) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <CheckCircle2 className="text-primary size-12" />
        <p className="text-foreground text-lg font-bold">등록이 완료되었습니다</p>
        <div className="bg-card w-full rounded-2xl p-5 shadow-card">
          <p className="text-text-dim text-sm">아래 정보로 로그인할 수 있습니다</p>
          <dl className="mt-3 space-y-2 text-left">
            <div>
              <dt className="text-text-dim text-xs">아이디</dt>
              <dd className="num text-foreground text-base font-bold break-all">{done.email}</dd>
            </div>
            <div>
              <dt className="text-text-dim text-xs">초기 비밀번호</dt>
              <dd className="num text-foreground text-base font-bold">{done.password}</dd>
            </div>
          </dl>
          <p className="text-text-dim mt-3 text-xs">
            로그인 후 &lsquo;내 정보&rsquo;에서 비밀번호를 꼭 변경해 주세요.
          </p>
        </div>
        <p className="text-text-dim text-xs">{academyName}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-4 px-3 py-6">
      <header className="text-center">
        <p className="text-text-dim text-xs font-bold">{academyName}</p>
        <h1 className="text-foreground mt-0.5 text-lg font-bold">직원 등록</h1>
        <p className="text-text-dim mt-1 text-sm">
          아래 직원 명부를 작성해 제출하면 로그인 계정이 함께 만들어집니다.
        </p>
      </header>
      <ResumeSheet
        data={data}
        userId="public"
        canWrite
        startEditing
        publicToken={token}
        submitAction={submitPublicStaffIntake}
        onSaved={onSaved}
      />
    </div>
  );
}
