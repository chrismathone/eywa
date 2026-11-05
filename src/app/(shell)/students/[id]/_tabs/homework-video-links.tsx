
import { SheetClassName, SheetText } from "@/features/teacher-view/interface-label";
import { requireAccess } from "@/lib/auth/require-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatShortKoreanDate, kstDateOf, kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getStudentEnrollments } from "@/features/students/server/queries";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { videoSubmitAvailability } from "@/features/video-submit/server/availability";
import { activeLinkSummary } from "@/features/video-submit/server/links";
import { siteAvailability } from "@/features/video-submit/server/site";
import { SITE_HOMEWORK_DAYS } from "@/features/video-submit/site";
import { getAppUrl } from "@/lib/config/app-url";
import { HomeworkVideoLinkButtons } from "./homework-video-link-buttons";

type LinkRow = { classId: string; className: string; count: number; until: string | null };

/**
 * 지금 다니는 반 중 **살아 있는 링크가 있는 반** + 올리기 사이트 주소(0330a). 쓸 수 없는 학원·조회 실패면 null(이 구역만 빠진다).
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
      if (!active?.count) continue; // 링크를 새로 만드는 길이 없으니, 끊을 링크가 있는 반만 줄을 세운다
      const until = formatShortKoreanDate(kstDateOf(new Date(Date.parse(active.lastExpiresAt) - 1)) ?? "");
      rows.set(e.classId, { classId: e.classId, className: e.className, count: active.count, until });
    }
    // 로그인한 계정의 지점으로 본다 — 지점마다 저장 폴더가 따로라, 다른 지점이 사이트를 쓴다고 이 지점에 주소를 적지 않는다.
    const site = await siteAvailability(undefined, user.tenantId).catch(() => null);
    const siteUrl = site?.ok ? `${getAppUrl()}/v` : null;
    return { rows: [...rows.values()], siteUrl };
  } catch (error) {
    console.warn(JSON.stringify({ level: "warn", scope: "videoSubmit.studentTab", message: error instanceof Error ? error.message : "unknown" }));
    return null;
  }
}

/**
 * 학생 상세 '숙제 영상' 탭 위 — **올리기 사이트 안내** + 이미 나간 링크 끊기.
 * 🔴 학생마다 제출 링크를 만드는 '제출 링크 복사'는 거뒀다(원장 2026-10-03 *"학생영상 개별링크는 더이상 생성하지않고 … 이제는 클래스노트
 *    업로드 혹은 /v 링크로만 업로드"*). 이미 나간 링크는 만든 날 + 7일에 저절로 끝나고, 그 전에 여기서 끊을 수 있다.
 * 🔴 쓸 수 없는 학원(ClassNote 기능 꺼짐·Drive 값·SQL 없음)에선 **아무것도 그리지 않는다**(흔적 없이). 조회가 실패해도
 *    탭 전체를 죽이지 않고 이 구역만 빠진다.
 * canRevoke = 서버 `revokeVideoSubmitLinks` 게이트와 같은 판정(`canWriteTenant(role, "students")`) — page.tsx가 계산해 내린다.
 *    읽기 권한이면 남은 링크(개수·기한)는 보이되 '링크 끊기'는 그리지 않는다(원장 2026-11-05 — lib/write-lock.ts).
 */
export async function HomeworkVideoLinks({ studentId, canRevoke }: { studentId: string; canRevoke: boolean }) {
  const loaded = await loadRows(studentId);
  if (!loaded || (!loaded.rows.length && !loaded.siteUrl)) return null;
  const { rows, siteUrl } = loaded;
  return (
    <section aria-label="숙제 영상 올리기" className="border-line space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-base font-bold"><SheetText value={"숙제 영상 올리기"} /></h3>
        {siteUrl ? (
          <p className="text-text-dim mt-1 text-sm break-keep">
            <SheetText value={"학생은 "} /><span className="text-foreground font-bold break-all">{siteUrl}</span> <SheetText value={"에서 휴대폰 뒷 4자리와 이름을 넣고, 원스크린에서 ‘영상 과제 있음’으로 낸 숙제를 골라 올립니다(선생님이 정한 마감까지 — 기본은 숙제가 나간 날로부터 "} />{SITE_HOMEWORK_DAYS}<SheetText value={"일 뒤, 10/1 숙제면 10/8까지 · ‘다음 수업’을 고르면 그 수업일까지). ClassNote에 올려도 됩니다."} /></p>
        ) : null}
        {rows.length ? (
          <p className="text-text-dim mt-1 text-sm break-keep">
            <SheetText value={canRevoke
              ? "아래는 아직 쓸 수 있는 제출 링크입니다(학생이 사이트에서 연 링크 · 예전에 보낸 링크). 적힌 날까지 쓸 수 있고, 그 전에 끊을 수 있습니다. 학생마다 링크를 새로 만들지는 않습니다."
              : "아래는 아직 쓸 수 있는 제출 링크입니다(학생이 사이트에서 연 링크 · 예전에 보낸 링크). 적힌 날까지 쓸 수 있습니다. 학생마다 링크를 새로 만들지는 않습니다."} /></p>
        ) : null}
      </div>
      {rows.length ? (
        <ul className="divide-line divide-y">
          {rows.map((row) => (
            <li key={row.classId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <span className="min-w-0 flex-1 text-sm font-bold"><SheetClassName value={row.className} /></span>
              <HomeworkVideoLinkButtons studentId={studentId} classId={row.classId} classLabel={row.className} count={row.count} until={row.until} canRevoke={canRevoke} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
