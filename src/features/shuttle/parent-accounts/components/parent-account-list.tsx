import { TONE_SOFT } from "@/lib/design/semantic-color";
import type { ParentAccount } from "../server/parents";
import { ParentAccountDelete } from "./parent-account-delete";

/**
 * 학부모 계정 목록 — '학부모 관리 현황' 화면과 '학부모 등하원'의 모달이 **같은 목록**을 그린다.
 * 🔴 원장·관리자 전용 데이터(로그인 이메일·연락처)다 — 부르는 쪽이 `parentAccountsActor()`로 걸러서 넘긴다.
 * 카드마다 [삭제](확인 칸을 거쳐 로그인·연결 삭제, `ParentAccountDelete`).
 * `readOnly`(읽기 강사뷰 · 지점 보기)면 [삭제]를 그리지 않는다 — 서버 액션도 같은 판정(readonlyTeacherViewError)으로 거절한다.
 */
export function ParentAccountList({ accounts, readOnly = false }: { accounts: readonly ParentAccount[]; readOnly?: boolean }) {
  if (accounts.length === 0) {
    return (
      <div className="border-line text-text-dim rounded-xl border border-dashed p-8 text-center text-sm">
        아직 발급된 학부모 계정이 없습니다.
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {accounts.map((account) => (
        <article key={account.id} className="border-line rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-bold">{account.displayName}</h3>
              <p className="text-text-dim text-sm break-all">
                {account.email} · {account.phone || "연락처 미등록"}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${TONE_SOFT[account.status === "active" ? "positive" : "inert"]}`}
            >
              {account.status === "active" ? "사용 중" : "중지"}
            </span>
          </div>
          <div className="mt-3 grid gap-2">
            {account.students.map((student) => (
              <div key={student.id} className="bg-bg-soft flex flex-wrap justify-between gap-2 rounded-lg px-3 py-2 text-sm">
                <span className="font-medium">
                  {student.name} · {student.schoolGrade}
                </span>
                <span className="text-text-dim">
                  {student.relationship} · {student.parentPhone || "원생 연락처 미등록"}
                </span>
              </div>
            ))}
          </div>
          {/* 삭제 — 확인 칸이 카드 폭을 다 쓰도록 카드 맨 아래에 둔다. */}
          {readOnly ? null : (
            <div className="mt-2 flex justify-end">
              <ParentAccountDelete accountId={account.id} name={account.displayName} studentCount={account.students.length} />
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
