import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { listPublicBranchChoices } from "@/features/owner/server/public-branding";
import type { TenantSettings } from "@/features/owner/settings-types";
import { SITE_BRANCH_NEEDED, type SiteBranch, type SiteBranchNeeded } from "../site";
import { videoSubmitAvailability } from "./availability";

type Db = ReturnType<typeof createAdminClient>;

/**
 * 숙제 영상 올리기 사이트(`/v`)의 **지점 판정** — 어느 지점이 사이트를 쓰나 · 공개 요청이 어느 지점 것인가(2026-10-04).
 *
 * 🔑 주소에 지점을 넣지 않는다(멀티테넌트 C안). 사이트를 쓰는 지점이 하나면 그 지점, 여럿이면 화면에서 고른다(자리 PIN과 같은 방식).
 * 🔴 고르지 않은 요청을 한 지점으로 떨어뜨리지 않는다 — 다른 지점의 같은 이름·같은 뒷자리 학생에게 올리게 된다.
 * 🔴 지점마다 저장 폴더가 따로다 — 모든 판정은 **그 지점의** 학원 설정·저장 폴더 설정만 읽는다(admin 클라는 RLS를 우회한다, [[#104]]).
 * 조회·열기 본체(학생 찾기·횟수 제한·링크 만들기)는 [`site.ts`](./site.ts) — 여기서 정한 지점 안에서만 돈다.
 */
/** 시도 표(0330a) — 횟수 제한(site.ts `admit`)과 "사이트를 열 수 있나"가 같은 표를 본다. */
export const SITE_ATTEMPTS_TABLE = "homework_video_site_attempts";

let attemptsTableReady = false;
/** 시도 표(0330a)가 있나 — 있으면 기억한다(생기기만 한다). 없으면 사이트를 열지 않는다(횟수 제한 없이 조회를 받지 않는다). */
async function siteSchemaReady(db: Db): Promise<boolean> {
  if (attemptsTableReady) return true;
  const { error } = await db.from(SITE_ATTEMPTS_TABLE).select("id").limit(1);
  attemptsTableReady = !error;
  return attemptsTableReady;
}

/** 테스트 전용 — 기억 리셋. */
export function _resetVideoSiteForTest(): void {
  attemptsTableReady = false;
}

/** 사이트를 쓸 수 있는 지점 한 곳 — 읽은 지점 설정을 함께 돌려준다(후보 판정이 같은 값을 쓴다 — 한 요청에서 두 번 읽지 않는다). */
export type ActiveSite = { ok: true; tenantId: string; academyName: string | null; settings: TenantSettings };
/**
 * `none` = 없는 주소처럼(지점이 없거나 ClassNote 기능·저장 폴더가 없다) · `unavailable` = 잠시 못 받음(SQL·워커 기록·순간 오류) ·
 * `choose` = **지점을 정해 불러야 한다**(지점 없이 부른 경우에만) — 쓸 수 있는 지점이 여럿이거나, 판정하지 못한 지점이 있어
 *   남은 한 지점으로 정할 수 없다(한 지점으로 떨어뜨리지 않는다).
 */
export type SiteAvailability = ActiveSite | { ok: false; reason: "none" | "unavailable" | "choose" };
/**
 * 사이트를 쓸 수 있는 지점들(이름순) — 하나도 없으면 까닭. `branchName` = 지점 선택지에 보이는 이름(자리 PIN과 같은 목록의 이름).
 * `partial` = **판정하지 못한 지점이 있다**(잠시 못 받음·조회 오류). 그 지점의 학생이 들어올 수 있으므로, 쓸 수 있는 지점이 하나여도
 *   그 지점으로 자동으로 정하지 않는다(화면이 지점을 고르게 한다).
 */
export type SiteDirectory =
  | { ok: true; sites: (ActiveSite & { branchName: string })[]; partial: boolean }
  | { ok: false; reason: "none" | "unavailable" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 이 지점엔 사이트가 **없다**(없는 주소처럼) — ClassNote 기능이 꺼졌거나 저장 폴더가 없다(정하지 않음·해제). 그 밖의 까닭은 "잠시 못 받음". */
const ABSENT_REASONS: ReadonlySet<string> = new Set(["module_off", "no_config", "disabled"]);
type BranchCheck = { state: "active"; site: ActiveSite } | { state: "absent" | "down" };

/**
 * 한 지점이 지금 사이트를 쓸 수 있나 — 🔴 **그 지점의** 학원 설정·저장 폴더 설정만 읽는다(다른 지점 값을 섞지 않는다).
 * 판정은 제출 링크와 같은 한 함수(`videoSubmitAvailability` — ClassNote 기능 · 그 지점의 저장 폴더 · SQL · 워커 기록)에 시도 표(0330a)를 더한 것.
 */
async function checkBranch(db: Db, tenantId: string): Promise<BranchCheck> {
  const settings = await getTenantSettingsByTenantId(tenantId);
  const availability = await videoSubmitAvailability(tenantId, settings, db);
  if (!availability.ok) return { state: ABSENT_REASONS.has(availability.reason) ? "absent" : "down" };
  if (!(await siteSchemaReady(db))) return { state: "down" };
  return { state: "active", site: { ok: true, tenantId, academyName: settings.profile.name?.trim() || null, settings } };
}

/**
 * 공개 지점 목록(자리 PIN과 같은 `listPublicBranchChoices`)을 지점마다 판정한다 — 독립 조회라 한꺼번에(B4).
 * 한 지점의 조회가 던져도 다른 지점은 그대로 선다(그 지점만 '잠시 못 받음'). `failure` = 던져진 첫 오류(순간 오류와 "없음"을 가른다).
 * `down` = 판정하지 못한 지점이 있다(잠시 못 받음·조회 오류) 또는 지점 목록 자체를 못 읽었다 — 🔴 이때는 남은 지점을 자동으로 고르지 않는다.
 *   (기능이 꺼졌거나 저장 폴더가 없는 지점은 `down`이 아니다 — 그 지점엔 사이트가 없으므로 남은 한 지점이 곧 유일한 지점이다.)
 */
async function scanBranches(db: Db): Promise<{ sites: (ActiveSite & { branchName: string })[]; down: boolean; failure: unknown }> {
  const branches = await listPublicBranchChoices();
  let failure: unknown = null;
  const checks = await Promise.all(branches.map((branch) =>
    checkBranch(db, branch.id).catch((error): BranchCheck => {
      failure ??= error;
      console.error(JSON.stringify({ level: "error", scope: "videoSite.branch", message: error instanceof Error ? error.message : "unknown" }));
      return { state: "down" };
    })));
  const sites = checks.flatMap((check, i) => (check.state === "active" ? [{ ...check.site, branchName: branches[i]!.name }] : []));
  // 지점 목록 자체를 못 읽었으면(빈 목록) 없는 주소로 단정하지 않는다.
  return { sites, down: !branches.length || checks.some((check) => check.state === "down"), failure };
}

/**
 * 사이트를 쓸 수 있는 지점 목록 — 공개 지점 목록 중 **실제로 지금 쓸 수 있는 지점만**.
 * 꺼진 지점은 목록에 올리지 않는다(있었는지조차 모르게). 하나도 없으면 까닭(`none` = 없는 주소처럼 · `unavailable` = 잠시 못 받음).
 */
export async function siteDirectory(db: Db = createAdminClient()): Promise<SiteDirectory> {
  const scan = await scanBranches(db);
  return scan.sites.length ? { ok: true, sites: scan.sites, partial: scan.down } : { ok: false, reason: scan.down ? "unavailable" : "none" };
}

/**
 * 사이트를 열 수 있나.
 *  · `tenantId`를 주면 **그 지점만** 본다 — 🔴 신뢰된 값만 넘길 것(보고서 행·링크 행·로그인한 계정의 지점). 화면이 보낸 값은
 *    `resolveSiteRequest`로(공개 지점 목록 안인지 다시 본다).
 *  · 안 주면 쓸 수 있는 지점이 **정확히 하나이고 판정하지 못한 지점이 없을 때만** 그 지점. 아니면 `choose`(한 지점으로 떨어뜨리지 않는다).
 */
export async function siteAvailability(db: Db = createAdminClient(), tenantId?: string | null): Promise<SiteAvailability> {
  if (tenantId != null) {
    if (!UUID_RE.test(tenantId)) return { ok: false, reason: "none" };
    const check = await checkBranch(db, tenantId);
    return check.state === "active" ? check.site : { ok: false, reason: check.state === "absent" ? "none" : "unavailable" };
  }
  const directory = await siteDirectory(db);
  if (!directory.ok) return directory;
  return directory.sites.length === 1 && !directory.partial ? directory.sites[0]! : { ok: false, reason: "choose" };
}

const toBranches = (sites: readonly { tenantId: string; branchName: string }[]): SiteBranch[] => sites.map((site) => ({ id: site.tenantId, name: site.branchName }));

/**
 * 공개 요청(조회·열기)의 지점을 정한다 — 화면이 보낸 `chosen`은 믿지 않는다.
 *  · 고르지 않았으면: 쓸 수 있는 지점이 하나이고 **판정하지 못한 지점이 없을 때만** 그 지점. 🔴 여럿이면 **거절**(지점을 고르게 한다).
 *    🔴 판정하지 못한 지점(잠시 못 받음·조회 오류)이 있으면 남은 지점으로 정하지 않는다 — 그 지점 학생의 요청일 수 있고, 남은 지점에
 *    같은 이름·같은 뒷자리 학생이 있으면 남의 학원 숙제가 나온다(교차 리뷰 2026-10-04). 화면은 지점을 늘 실어 보내므로 이 길은 옛 화면뿐이다.
 *  · 골랐으면: 공개 지점 목록 안의 지점이고 **지금 사이트를 쓸 수 있을 때만**(그 지점만 본다 — 다른 지점의 상태와 무관하다).
 *    모양이 틀린 값·목록 밖 번호·꺼진 지점은 거절.
 * 거절엔 지금 고를 수 있는 지점을 함께 준다(화면이 그 자리에서 선택지를 다시 세운다 — 다른 지점으로 저절로 옮겨 가지 않는다).
 * 조회 오류는 **던진다**(호출부가 "잠시 후 다시"로 받는다 — 순간 오류를 "받을 수 없다"로 바꿔 말하지 않는다).
 */
export async function resolveSiteRequest(db: Db, chosen: unknown): Promise<{ ok: true; site: ActiveSite } | { ok: false; unavailable: true } | SiteBranchNeeded> {
  const picked = chosen == null || chosen === "" ? null : chosen;
  if (typeof picked === "string" && UUID_RE.test(picked) && (await listPublicBranchChoices()).some((branch) => branch.id === picked)) {
    const check = await checkBranch(db, picked);
    if (check.state === "active") return { ok: true, site: check.site };
  }
  const scan = await scanBranches(db);
  if (!scan.sites.length) {
    if (scan.failure) throw scan.failure;
    return { ok: false, unavailable: true };
  }
  if (picked === null) {
    if (scan.down) {
      if (scan.failure) throw scan.failure;
      return { ok: false, unavailable: true };
    }
    if (scan.sites.length === 1) return { ok: true, site: scan.sites[0]! };
  }
  return { ok: false, code: "branch", error: SITE_BRANCH_NEEDED, branches: toBranches(scan.sites) };
}
