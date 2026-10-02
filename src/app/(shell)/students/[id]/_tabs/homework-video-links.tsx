import { requireAccess } from "@/lib/auth/require-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatShortKoreanDate, kstDateOf, kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getStudentEnrollments } from "@/features/students/server/queries";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { videoSubmitAvailability } from "@/features/video-submit/server/availability";
import { activeLinkSummary } from "@/features/video-submit/server/links";
import { siteAvailability } from "@/features/video-submit/server/site";
import { getAppUrl } from "@/lib/config/app-url";
import { HomeworkVideoLinkButtons } from "./homework-video-link-buttons";

type LinkRow = { classId: string; className: string; count: number; until: string | null };

/**
 * 지금 다니는 반 × 살아 있는 링크 요약 + 올리기 사이트 주소(0330a). 쓸 수 없는 학원·조회 실패면 null(이 구역만 빠진다).
 * 사이트 주소는 **이 지점이 사이트를 쓸 수 있을 때만** 준다(Drive가 묶인 지점 · SQL 적용됨) — 못 쓰는데 주소를 적으면 거짓 안내다.
 */
async function loadRows(studentId: string): Promise<{ rows: LinkRow[]; siteUrl: string | null } | null> {
  const user = await requireAccess("students"); // 페이지가 이미 통과한 게이트 — try 밖(리다이렉트를 삼키지 않게)
  try {
    const availability = await videoSubmitAvailability(user.tenantId, await getTenantSettings());
    if (!availability.ok) return null;
    const today = kstToday();
    const [enrollments, summary] = await Promise.all([
      getStudentEnrollments(studentId),
      activeLinkSummary(createAdminClient(), user.tenantId, studentId),
    ]);
    const rows = new Map<string, LinkRow>();
    for (const e of enrollments) {
      if (!e.classId || rows.has(e.classId) || isEnrollmentEndedOn(e.endDate, today, e.isTransferred)) continue;
      const active = summary.get(e.classId);
      const until = active ? formatShortKoreanDate(kstDateOf(new Date(Date.parse(active.lastExpiresAt) - 1)) ?? "") : null;
      rows.set(e.classId, { classId: e.classId, className: e.className, count: active?.count ?? 0, until });
    }
    const site = await siteAvailability().catch(() => null);
    const siteUrl = site?.ok && site.tenantId === user.tenantId ? `${getAppUrl()}/v` : null;
    return { rows: [...rows.values()], siteUrl };
  } catch (error) {
    console.warn(JSON.stringify({ level: "warn", scope: "videoSubmit.studentTab", message: error instanceof Error ? error.message : "unknown" }));
    return null;
  }
}

/**
 * 학생 상세 '숙제 영상' 탭 위 — 반마다 **제출 링크 복사 · 링크 끊기**(원장 2026-10-01). 선생님·관리자가 복사해서 학부모에게 보낸다.
 * 🔴 쓸 수 없는 학원(ClassNote 기능 꺼짐·Drive 값·SQL 없음)에선 **아무것도 그리지 않는다**(흔적 없이). 조회가 실패해도
 *    탭 전체를 죽이지 않고 이 구역만 빠진다.
 */
export async function HomeworkVideoLinks({ studentId }: { studentId: string }) {
  const loaded = await loadRows(studentId);
  if (!loaded?.rows.length) return null;
  const { rows, siteUrl } = loaded;
  return (
    <section aria-label="영상 제출 링크" className="border-line space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-base font-bold">영상 제출 링크</h3>
        <p className="text-text-dim mt-1 text-sm break-keep">
          학부모가 로그인 없이 숙제 영상을 올리는 링크입니다(7일). 복사해서 보내 주세요. 올린 영상은 그 반 담임 폴더에 들어가고 이 탭에 바로 잡힙니다.
        </p>
        {siteUrl ? (
          // 올리기 사이트(0330a) — 링크를 따로 보내지 않아도 학생이 직접 연다(휴대폰 뒷 4자리 → 이름·반 고르기).
          <p className="text-text-dim mt-1 text-sm break-keep">
            링크 없이도 올릴 수 있습니다 — 학생이 <span className="text-foreground font-bold break-all">{siteUrl}</span> 에서 휴대폰 뒷 4자리를 넣고 반을 고르면 됩니다.
          </p>
        ) : null}
      </div>
      <ul className="divide-line divide-y">
        {rows.map((row) => (
          <li key={row.classId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <span className="min-w-0 flex-1 text-sm font-bold">{row.className}</span>
            <span className="text-text-dim text-sm">{row.count ? `쓰는 중 ${row.count}개 · ${row.until}까지` : "쓰는 중인 링크 없음"}</span>
            <HomeworkVideoLinkButtons studentId={studentId} classId={row.classId} classLabel={row.className} hasActive={row.count > 0} />
          </li>
        ))}
      </ul>
    </section>
  );
}
