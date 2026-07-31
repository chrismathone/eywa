import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";
import type { SystemRole } from "@/lib/permissions";
import { audienceMatchesRole } from "../audience";
import { isDismissed, type DismissRecord } from "../dismiss";

/** 공지 팝업 캐시 무효화 태그(tenantId별). CRUD 액션이 updateTag로 비운다. */
export function noticePopupsTag(tenantId: string): string {
  return `notice-popups:${tenantId}`;
}

/** 셸 진입 표시용(최소 필드 + 이미지 signed URL). updatedAt=클라 dismiss 버전(수정 시 재노출). */
export type ActivePopup = {
  id: string;
  title: string;
  body: string | null;
  imageSrc: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  width: number;
  position: string;
  updatedAt: string;
};

const ACTIVE_SELECT =
  "id, title, body, image_url, link_url, link_label, audience, width, position, priority, starts_at, ends_at, updated_at";

/**
 * 테넌트 활성 팝업 raw — tenantId별 `unstable_cache`로 캐싱(B6: 멀티윈도우 셸 재실행 공유).
 * admin client + 신뢰 tenantId 키라 쿠키 없이 안전(getTenantSettings 패턴). 이미지 signed URL(GCS)
 * resolve도 캐시 안에서 1회 → 매 네비마다 GCS 호출 방지(TTL 60s, CRUD가 updateTag로 즉시 무효화).
 * 노출기간(starts/ends) 필터는 캐시 시점 기준(≤60s 지연 허용 — 팝업 스케줄에 충분).
 */
const loadActivePopupsRaw = (tenantId: string) =>
  unstable_cache(
    async (): Promise<(ActivePopup & { audience: string })[]> => {
      const admin = createAdminClient();
      const { data } = await admin
        .from("notice_popups")
        .select(ACTIVE_SELECT)
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(20);
      const now = Date.now();
      const rows = (data ?? []).filter((r) => {
        const starts = r.starts_at ? new Date(r.starts_at as string).getTime() : null;
        const ends = r.ends_at ? new Date(r.ends_at as string).getTime() : null;
        return (starts === null || starts <= now) && (ends === null || ends >= now);
      });
      return Promise.all(
        rows.map(async (r) => ({
          id: r.id as string,
          title: r.title as string,
          body: (r.body as string | null) ?? null,
          imageSrc: await resolveBrandingSrc(r.image_url as string | null, tenantId),
          linkUrl: (r.link_url as string | null) ?? null,
          linkLabel: (r.link_label as string | null) ?? null,
          width: (r.width as number | null) ?? 380,
          position: (r.position as string | null) ?? "cascade",
          audience: r.audience as string,
          updatedAt: r.updated_at as string,
        })),
      );
    },
    ["notice-popups", tenantId],
    { tags: [noticePopupsTag(tenantId)], revalidate: 60 },
  )();

/**
 * 셸 진입 표시용 — 테넌트 활성 팝업 중 ① 역할(audience)에 맞고 ② 이 **계정**이 끄지 않은 것만.
 * dismiss는 계정 단위 DB(notice_dismissals, 0162a)라 브라우저·포트·PC가 달라도 따라온다
 * (localStorage 시절엔 origin=포트별로 따로 놀아 "다시 보지 않기"가 매번 리셋됐다).
 * 팝업 본문은 tenantId별 캐시, dismiss만 사용자별 1쿼리(PK 조회) — 캐시엔 개인 상태를 넣지 않는다.
 */
export async function getActivePopups(
  role: SystemRole,
  tenantId: string,
  userId: string,
): Promise<ActivePopup[]> {
  const all = await loadActivePopupsRaw(tenantId);
  const forRole = all.filter((p) => audienceMatchesRole(p.audience, role));
  if (forRole.length === 0) return [];

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("notice_dismissals")
    .select("popup_id, until, version")
    .eq("user_id", userId)
    // forRole은 위 raw 쿼리의 limit 20으로 상한이 걸려 있어 .in()이 안전(B3의 대량 id 케이스 아님).
    .in(
      "popup_id",
      forRole.map((p) => p.id),
    );
  const dismissed = new Map<string, DismissRecord>(
    (rows ?? []).map((r) => [
      r.popup_id as string,
      { until: (r.until as string | null) ?? null, version: r.version as string },
    ]),
  );
  const now = Date.now();

  return forRole
    .filter((p) => !isDismissed(dismissed.get(p.id), p.updatedAt, now))
    .map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      imageSrc: p.imageSrc,
      linkUrl: p.linkUrl,
      linkLabel: p.linkLabel,
      width: p.width,
      position: p.position,
      updatedAt: p.updatedAt,
    }));
}

/** 관리(owner)용 — 전체 팝업(비활성 포함). 미리보기 썸네일용 imageSrc도 resolve. */
export type AdminPopup = {
  id: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  imageSrc: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  audience: string;
  width: number;
  position: string;
  priority: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

export async function listPopups(): Promise<AdminPopup[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("notice_popups")
    .select(
      "id, title, body, image_url, link_url, link_label, audience, width, position, priority, is_active, starts_at, ends_at",
    )
    .order("is_active", { ascending: false })
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  return Promise.all(
    (data ?? []).map(async (r) => ({
      id: r.id as string,
      title: r.title as string,
      body: (r.body as string | null) ?? null,
      imageUrl: (r.image_url as string | null) ?? null,
      imageSrc: await resolveBrandingSrc(r.image_url as string | null, user.tenantId),
      linkUrl: (r.link_url as string | null) ?? null,
      linkLabel: (r.link_label as string | null) ?? null,
      audience: r.audience as string,
      width: (r.width as number | null) ?? 380,
      position: (r.position as string | null) ?? "cascade",
      priority: (r.priority as number | null) ?? 0,
      isActive: (r.is_active as boolean) ?? true,
      startsAt: (r.starts_at as string | null) ?? null,
      endsAt: (r.ends_at as string | null) ?? null,
    })),
  );
}
