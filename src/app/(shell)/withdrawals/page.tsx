import Link from "next/link";
import { UserMinus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getWithdrawnStudents,
  REASON_LABEL,
  type WithdrawalReason,
} from "@/features/withdrawals/server/queries";

export const metadata = { title: "퇴원관리 — eywa" };

const SUBJECT_LABEL: Record<string, string> = {
  math: "수학",
  english: "영어",
  korean: "국어",
  science: "과학",
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

export default async function WithdrawalsPage() {
  await requireAccess("withdrawals");
  const rows = await getWithdrawnStudents();

  // metadata.reason 우선, 없으면 enrollment.withdrawal_reason 텍스트, 그것도 없으면 "미기재"
  const reasonCounts = new Map<string, number>();
  for (const r of rows) {
    const key = r.metadata?.reason
      ? REASON_LABEL[r.metadata.reason as WithdrawalReason]
      : (r.withdrawalReason ?? "미기재");
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  const topReasons = Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="퇴원관리"
        description={`퇴원 학생 ${rows.length}명 · 사유 통계와 직전 수강 반을 함께 표시합니다.`}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={UserMinus}
          title="퇴원 학생이 없습니다"
          description="status='withdrawn' 학생이 생기면 이곳에 표시됩니다."
        />
      ) : (
        <>
          {topReasons.length > 0 ? (
            <section className="bg-card border-border rounded-lg border p-5">
              <header className="mb-4">
                <p className="eyebrow">사유 통계</p>
                <h2 className="text-foreground mt-1 text-sm font-semibold">상위 퇴원 사유</h2>
              </header>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {topReasons.map(([reason, count]) => (
                  <li
                    key={reason}
                    className="border-border bg-muted/30 rounded-md border px-4 py-3"
                  >
                    <p className="text-foreground text-sm">{reason}</p>
                    <p className="text-muted-foreground num mt-1 text-xs">
                      <span className="text-foreground font-semibold">{count}명</span> ·{" "}
                      {((count / rows.length) * 100).toFixed(0)}%
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="bg-card border-border overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-border text-muted-foreground border-b text-left text-xs">
                <tr>
                  <th className="eyebrow px-5 py-3 font-normal">학년</th>
                  <th className="eyebrow px-5 py-3 font-normal">이름</th>
                  <th className="eyebrow px-5 py-3 font-normal">학교</th>
                  <th className="eyebrow px-5 py-3 font-normal">직전 수강 반</th>
                  <th className="eyebrow px-5 py-3 font-normal">담임</th>
                  <th className="eyebrow px-5 py-3 font-normal">사유</th>
                  <th className="eyebrow num px-5 py-3 text-right font-normal">퇴원일</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {rows.map((r) => {
                  const ago = daysSince(r.withdrawnAt);
                  return (
                    <tr key={r.id} className="hover:bg-accent/40 transition-colors">
                      <td className="text-muted-foreground px-5 py-3">{r.grade ?? "—"}</td>
                      <td className="text-foreground px-5 py-3 font-medium">
                        <Link href={`/withdrawals/${r.id}`} className="hover:underline">
                          {r.name}
                        </Link>
                      </td>
                      <td className="text-muted-foreground px-5 py-3">{r.school ?? "—"}</td>
                      <td className="text-muted-foreground px-5 py-3 text-xs">
                        {r.lastClassName ? (
                          <span>
                            {r.lastClassName}
                            {r.lastClassSubject ? (
                              <span className="ml-1.5">
                                ({SUBJECT_LABEL[r.lastClassSubject] ?? r.lastClassSubject})
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-muted-foreground px-5 py-3">
                        {r.primaryTeacherName ?? "—"}
                      </td>
                      <td className="text-foreground px-5 py-3 text-xs">
                        {r.withdrawalReason ?? (
                          <span className="text-muted-foreground italic">미기재</span>
                        )}
                      </td>
                      <td className="num px-5 py-3 text-right">
                        <span className="text-foreground">{r.withdrawnAt ?? "—"}</span>
                        {ago !== null ? (
                          <span className="text-muted-foreground ml-1.5 text-xs">
                            {ago}일 전
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
