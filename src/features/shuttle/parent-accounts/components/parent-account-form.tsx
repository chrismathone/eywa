"use client";

import { useActionState } from "react";
import { createParentAccount, type ParentActionState } from "../server/parent-actions";
import type { ParentStudentOption } from "../server/parents";

const initialState: ParentActionState = {};

/**
 * 학부모 계정 발급 폼 — '학부모 관리 현황' 화면과 '학부모 등하원' 모달이 함께 쓴다.
 * 서버 액션(`createParentAccount`)이 원장·관리자 판정을 다시 본다(화면 조건은 게이트가 아니다, #77).
 * `framed`=false면 바깥 카드 테두리 없이 그린다(모달 안).
 */
export function ParentAccountForm({ students, framed = true }: { students: ParentStudentOption[]; framed?: boolean }) {
  const [state, action, pending] = useActionState(createParentAccount, initialState);

  return (
    <form action={action} className={`flex flex-col gap-4 ${framed ? "border-line bg-card rounded-2xl border p-4" : ""}`}>
      <div>
        <h2 className="text-lg font-bold">학부모 계정 발급</h2>
        <p className="text-text-dim mt-1 text-sm">학부모가 사용할 로그인과 연결할 원생을 등록합니다.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          학부모 이름
          <input name="displayName" className="border-line rounded-lg border px-3 py-2" placeholder="김민수 어머님" required />
          {state.fieldErrors?.displayName ? <span className="text-danger text-xs">{state.fieldErrors.displayName}</span> : null}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          연락처
          <input name="phone" className="border-line rounded-lg border px-3 py-2" placeholder="010-0000-0000" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          로그인 이메일
          <input name="email" type="email" className="border-line rounded-lg border px-3 py-2" placeholder="parent@example.com" required />
          {state.fieldErrors?.email ? <span className="text-danger text-xs">{state.fieldErrors.email}</span> : null}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          임시 비밀번호
          <input name="password" type="password" className="border-line rounded-lg border px-3 py-2" placeholder="8자 이상" required />
          {state.fieldErrors?.password ? <span className="text-danger text-xs">{state.fieldErrors.password}</span> : null}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          연결 원생
          <select name="studentId" className="border-line rounded-lg border bg-transparent px-3 py-2" required defaultValue="">
            <option value="" disabled>
              원생을 선택하세요
            </option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.label}
              </option>
            ))}
          </select>
          {state.fieldErrors?.studentId ? <span className="text-danger text-xs">{state.fieldErrors.studentId}</span> : null}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          관계
          <select name="relationship" className="border-line rounded-lg border bg-transparent px-3 py-2" defaultValue="부모">
            <option value="부모">부모</option>
            <option value="어머니">어머니</option>
            <option value="아버지">아버지</option>
            <option value="보호자">보호자</option>
          </select>
        </label>
      </div>
      {state.error ? <p className="text-danger text-sm">{state.error}</p> : null}
      {state.ok ? <p className="text-green text-sm">학부모 계정을 발급했습니다.</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
      >
        {pending ? "발급 중..." : "학부모 계정 발급"}
      </button>
    </form>
  );
}
