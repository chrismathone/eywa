import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";
import type { SystemRole } from "@/lib/permissions";
import { audienceMatchesRole } from "../audience";
import { isDismissed, type DismissRecord } from "../dismiss";
// 화면 언어(2026-09-03) — 영어로 보는 사람에게만 캐시된 번역을 덮어씌운다(0249a).
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { noticeSourceHash } from "../translate-rules";

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

  const shown = forRole
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

  return applyEnglishOverlay(shown);
}

/**
 * 영어로 보는 사람에게만 **캐시된 번역을 덮어씌운다**(0249a).
 *
 * 🔴 **여기서 AI를 부르지 않는다** — 팝업은 셸 진입마다(= 창마다) 도는 경로라, 로드 시 번역하면
 *    창 수만큼 곱해진다(B6 + CLAUDE.md *"페이지 로드만으로 절대 새 호출 안 함"*). 만드는 것은
 *    저장 시점·[영문 만들기] 버튼뿐이고 여기는 **읽기만** 한다.
 * 🔴 **없거나·해시가 어긋나거나·조회가 실패하면 한국어 원문 그대로** — 빈 팝업은 고장으로 읽히고,
 *    옛 번역이 새 글인 척하는 것보다 한국어가 정직하다. 0249a 미적용도 이 갈래로 조용히 떨어진다([[#95]]).
 * ⚠️ 한국어 사용자에겐 **조회조차 하지 않는다**(왕복 0 — 대부분의 사용자가 여기다).
 */
async function applyEnglishOverlay(popups: ActivePopup[]): Promise<ActivePopup[]> {
  if (popups.length === 0) return popups;
  // 화면 언어는 강사 미니셸에서만 en이 될 수 있다(관리자는 항상 ko) — 그 판정을 그대로 재사용한다.
  const lang = await getTeacherViewLang();
  if (lang !== "en") return popups;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("notice_popup_translations")
      .select("notice_id, title, body, link_label, source_hash")
      .eq("lang", "en")
      // 상한 20짜리 목록이라 `.in()`이 안전(B3의 대량 id 케이스 아님).
      .in(
        "notice_id",
        popups.map((p) => p.id),
      );
    if (error) return popups; // 표 없음·조회 실패 → 한국어 원문(화면은 그대로 산다)
    const byId = new Map((data ?? []).map((r) => [r.notice_id as string, r]));
    return popups.map((p) => {
      const t = byId.get(p.id);
      if (!t) return p;
      // 🔴 원문이 바뀌었으면(해시 불일치) 옛 번역을 쓰지 않는다 — 지금 글과 다른 말을 띄우는 것이
      //    번역이 없는 것보다 나쁘다(다음 저장·버튼에서 다시 만들어진다).
      if ((t.source_hash as string | null) !== noticeSourceHash(p)) return p;
      return {
        ...p,
        title: (t.title as string | null) ?? p.title,
        body: (t.body as string | null) ?? p.body,
        // ⚠️ linkLabel은 null이면 카드가 '자세히 보기' 기본값을 쓴다 — 원문 null을 덮지 않는다.
        linkLabel: (t.link_label as string | null) ?? p.linkLabel,
      };
    });
  } catch {
    return popups;
  }
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
  /**
   * 영문 번역 상태(0249a) — `none`(없음) · `stale`(원문이 바뀜) · `ready`(최신) · `skipped`(민감정보 등).
   * ⚠️ 표가 없으면(미적용) 전부 `none` — 화면은 [영문 만들기] 버튼만 보이고 죽지 않는다([[#95]]).
   */
  enStatus: "none" | "stale" | "ready" | "skipped";
  /** `skipped`일 때의 사유(사람 말). 그 외 null. */
  enSkipReason: string | null;
};

/**
 * 팝업별 영문 번역 상태 — **조회 실패·표 없음이면 빈 맵**(전부 '없음'으로 보인다, [[#95]]).
 * 🔴 여기서 번역을 만들지 않는다(목록을 여는 것은 명시 트리거가 아니다).
 */
async function loadEnStatus(
  ids: string[],
): Promise<Map<string, { hash: string; skip: string | null }>> {
  if (ids.length === 0) return new Map();
  try {
    const { data, error } = await createAdminClient()
      .from("notice_popup_translations")
      .select("notice_id, source_hash, skip_reason")
      .eq("lang", "en")
      .in("notice_id", ids);
    if (error) return new Map();
    return new Map(
      (data ?? []).map((r) => [
        r.notice_id as string,
        { hash: (r.source_hash as string) ?? "", skip: (r.skip_reason as string | null) ?? null },
      ]),
    );
  } catch {
    return new Map();
  }
}

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

  const enStatus = await loadEnStatus((data ?? []).map((r) => r.id as string));

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
      ...enStatusOf(enStatus.get(r.id as string), {
        title: r.title as string,
        body: (r.body as string | null) ?? null,
        linkLabel: (r.link_label as string | null) ?? null,
      }),
    })),
  );
}

/**
 * 저장된 번역 행 + 지금 원문 → 화면에 적을 상태.
 * 🔴 해시가 어긋나면 `stale`(있지만 안 쓴다) — "있음"으로 뭉치면 사람이 옛 번역이 나가는 줄 모른다.
 */
function enStatusOf(
  row: { hash: string; skip: string | null } | undefined,
  src: { title: string; body: string | null; linkLabel: string | null },
): { enStatus: AdminPopup["enStatus"]; enSkipReason: string | null } {
  if (!row) return { enStatus: "none", enSkipReason: null };
  const fresh = row.hash === noticeSourceHash(src);
  if (row.skip) return { enStatus: fresh ? "skipped" : "none", enSkipReason: fresh ? row.skip : null };
  return { enStatus: fresh ? "ready" : "stale", enSkipReason: null };
}
