import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { listClassReviews } from "@/features/class-review/server/queries";

export const metadata = { title: "수업 평가 — eywa" };

/**
 * 수업 평가 체크리스트(참관) 목록 — 시트 "수업 상향화 체크리스트" 이식 초안(2026-08-04).
 * 접근은 class_review 메뉴 게이트(기본 전원 차단, 개인 예외로만 개방 — 테스트 단계).
 */
export default async function ClassReviewPage() {
  await requireAccess("class_review");
  const [rows, settings] = await Promise.all([listClassReviews(), getTenantSettings()]);
  const subjects = buildSubjectMaps(settings.operations.subjects);

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        eyebrow="운영"
        title="수업 평가 체크리스트"
        description="참관 30문항(4점 척도) — 참관자 3명과 본인이 각자 채점하고 나란히 비교합니다."
        embedLabel="수업 평가 체크리스트"
        actions={
          <Button size="sm" render={<Link href="/class-review/new" />}>
            + 새 참관
          </Button>
        }
      />

      {rows.length === 0 ? (
        <div className="border-line rounded-2xl border border-dashed p-10 text-center">
          <p className="text-text-dim text-sm">아직 참관 건이 없습니다 — &lsquo;새 참관&rsquo;으로 시작하세요.</p>
        </div>
      ) : (
        <div className="border-line bg-card overflow-x-auto rounded-2xl border shadow-card">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-line bg-bg-soft/60 border-b text-left">
                <th className="px-4 py-2.5 font-semibold">참관일</th>
                <th className="px-4 py-2.5 font-semibold">강사</th>
                <th className="px-4 py-2.5 font-semibold">과목</th>
                <th className="px-4 py-2.5 font-semibold">반명 · 회차</th>
                <th className="px-4 py-2.5 text-right font-semibold">제출</th>
                <th className="px-4 py-2.5 text-right font-semibold">환산점수</th>
                <th className="px-4 py-2.5 text-right font-semibold">등급</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-line/60 hover:bg-bg-soft/40 border-b last:border-0">
                  <td className="px-4 py-2.5">
                    <Link href={`/class-review/${r.id}`} className="text-primary num font-medium hover:underline">
                      {r.header.date || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{r.header.teacherName || "—"}</td>
                  <td className="px-4 py-2.5">
                    {r.header.subject ? (
                      <Pill color={subjects.colorOf(r.header.subject)} soft>
                        {subjects.labelOf(r.header.subject)}
                      </Pill>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {[r.header.className, r.header.session && `${r.header.session}회차`].filter(Boolean).join(" · ") ||
                      "—"}
                  </td>
                  <td className="num px-4 py-2.5 text-right">
                    {r.submittedCount}/{r.evaluators.length}
                  </td>
                  <td className="num px-4 py-2.5 text-right font-semibold">
                    {r.averages ? r.averages.percent.toFixed(1) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {r.averages ? (
                      <Pill color={r.averages.grade === "재참관" ? "danger" : "primary"} soft>
                        {r.averages.grade}
                      </Pill>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-text-faint text-[11px]">
        환산점수 = 제출된 채점들의 문항 평균으로 계산한 100점 기준 점수 · 등급 컷 S≥95 · A+≥90 · A≥85 · B+≥80 ·
        B≥75 · C≥70 · 미만 재참관
      </p>
    </div>
  );
}
