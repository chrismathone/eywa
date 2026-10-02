import "server-only";
import { createHash, createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { formatShortKoreanDate, kstToday } from "@/lib/date-kst";
import { logActionAs } from "@/features/audit/server/log";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import type { TenantSettings } from "@/features/owner/settings-types";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import { shareExpiryDate } from "@/features/onescreen/share-expiry";
import { maskStudentName } from "../rules";
import {
  isLast4,
  isSiteName,
  phoneEndsWith,
  siteNameMatches,
  siteLinkExpiresAt,
  siteLinkLastDay,
  SITE_LINKS_PER_PAIR_PER_DAY,
  SITE_LOOKUPS_PER_HOUR,
  SITE_LOOKUPS_PER_HOUR_TENANT,
  SITE_MAX_CHOICES,
  SITE_MAX_STUDENTS_PER_LAST4,
  SITE_OPENS_PER_HOUR,
  type SiteLookupResult,
  type SiteOpenResult,
} from "../site";
import { videoSubmitAvailability } from "./availability";
import { readVideoDriveConfig } from "./drive-config";
import { mintSubmitLink } from "./links";
import { openHomeworkDates } from "./site-homework";

type Db = ReturnType<typeof createAdminClient>;

/**
 * 숙제 영상 **올리기 사이트**(`/v`, 0330a) — 뒷 4자리 **+ 이름**으로 학생을 찾고, 선생님이 낸 **영상 숙제 중 아직 안 낸 것**을
 * 보여 준 뒤, 고른 숙제의 제출 링크를 그 자리에서 만든다(원장 2026-10-03). 숙제가 없으면 올릴 길이 없다.
 * 올리기 자체는 기존 제출 링크 길을 그대로 탄다(`/v/<토큰>?h=숙제일` · upload-start/complete — 형식·크기·횟수 제한·Drive 대조까지 같은 코드).
 *
 * 🔑 지점 = Drive가 묶인 지점 하나(`CLASSNOTE_VIDEO_TENANT_ID`) — 주소에 지점이 없고(멀티테넌트 C안), 영상이 들어갈 Drive가 그 학원 것이다.
 * 🔴 로그인 없는 화면이다 — 모든 조회에 그 지점 필터(admin은 RLS 우회, [[#104]]). 학생·반 번호는 화면에 내려보내지 않는다(고른 값은 지문으로만).
 * 🔴 실패 원문은 서버 로그에만. 화면엔 한글 한 줄.
 */
export const SITE_ACTOR = "숙제 영상 올리기 사이트(학생)";
const ATTEMPTS = "homework_video_site_attempts";
const UNAVAILABLE = "지금은 영상을 받을 수 없습니다. 선생님께 알려 주세요.";
const LIMITED = "잠시 동안 너무 많이 시도했습니다. 조금 뒤에 다시 해 주세요.";
const FAILED = "확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const NAME_NEEDED = "이름을 두 글자 이상 입력해 주세요.";
const NOT_FOUND = "번호와 이름이 맞는 학생을 찾지 못했습니다. 번호와 이름을 다시 확인하거나 선생님께 알려 주세요.";
/** 번호·이름은 맞지만 올릴 숙제가 없다 — "찾지 못했다"와 가른다(영상 숙제가 없는 반의 학생이 검색이 안 되는 것으로 오해하지 않게, 원장 2026-10-03). */
const NO_HOMEWORK = "지금 올릴 영상 숙제가 없습니다. 선생님이 영상 숙제를 낸 수업이 있을 때만 여기서 올릴 수 있습니다.";
const TOO_MANY = "이 번호로는 여기서 올릴 수 없습니다. 선생님께 영상 제출 링크를 받아 주세요.";
const STALE = "시간이 지나 다시 확인이 필요합니다. 번호와 이름을 다시 입력해 주세요.";
const PAIR_BLOCKED = "오늘은 여기서 더 열 수 없습니다. 선생님께 알려 주세요.";
/** 끝자리 조회에서 받는 행의 상한 — 이보다 많이 걸리면 그 번호는 사이트에서 안내하지 않는다(조용히 자르지 않는다, B2). */
const LOOKUP_ROW_LIMIT = 200;

/** 사이트가 쓰는 지점 — Drive 값이 없으면 null(사이트 자체가 없다). */
export function siteTenantId(): string | null {
  return readVideoDriveConfig()?.tenantId ?? null;
}

let attemptsTableReady = false;
/** 시도 표(0330a)가 있나 — 있으면 기억한다(생기기만 한다). 없으면 사이트를 열지 않는다(횟수 제한 없이 조회를 받지 않는다). */
async function siteSchemaReady(db: Db): Promise<boolean> {
  if (attemptsTableReady) return true;
  const { error } = await db.from(ATTEMPTS).select("id").limit(1);
  attemptsTableReady = !error;
  return attemptsTableReady;
}

/** 테스트 전용 — 기억 리셋. */
export function _resetVideoSiteForTest(): void {
  attemptsTableReady = false;
}

export type SiteAvailability =
  | { ok: true; tenantId: string; academyName: string | null; settings: TenantSettings }
  | { ok: false; reason: "none" | "unavailable" };

/**
 * 사이트를 열 수 있나 — 지점이 없거나 ClassNote 기능이 꺼졌으면 `none`(없는 주소처럼), Drive·SQL이 아직이면 `unavailable`.
 * 읽은 지점 설정을 함께 돌려준다(후보 판정이 같은 값을 쓴다 — 한 요청에서 두 번 읽지 않는다).
 */
export async function siteAvailability(db: Db = createAdminClient()): Promise<SiteAvailability> {
  const tenantId = siteTenantId();
  if (!tenantId) return { ok: false, reason: "none" };
  const settings = await getTenantSettingsByTenantId(tenantId);
  const availability = await videoSubmitAvailability(tenantId, settings, db);
  if (!availability.ok) return { ok: false, reason: availability.reason === "module_off" ? "none" : "unavailable" };
  if (!(await siteSchemaReady(db))) return { ok: false, reason: "unavailable" };
  return { ok: true, tenantId, academyName: settings.profile.name?.trim() || null, settings };
}

/**
 * IP 지문 — 서버 비밀값으로 서명한 해시(원본 IP는 저장하지 않는다). 소금 없는 해시는 IPv4 전수 대입으로 되돌릴 수 있어
 * 서버만 아는 키로 묶는다. 키가 없는 환경(테스트)에서는 지점 번호가 키가 된다 — 같은 IP가 같은 값이 되는 것만 필요하다.
 */
const ipHashOf = (ip: string | null, tenantId: string) =>
  createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY || tenantId).update(`${ip ?? "unknown"}:${tenantId}`).digest("hex");
/** 숙제 지문 — 그 지점·학생·반·숙제일·조회한 날. 화면엔 이 값만 가고, 열 때 서버가 같은 조회를 다시 해 이 지문이 그 안에 있는지 본다. */
const choiceId = (tenantId: string, studentId: string, classId: string, homeworkDate: string, day: string) =>
  createHash("sha256").update(`${tenantId}:${studentId}:${classId}:${homeworkDate}:${day}`).digest("hex").slice(0, 40);

/**
 * 시도 1건을 받아도 되나 — 줄을 **먼저 넣고** 한 시간 창의 횟수로 판정한다(동시에 여러 개가 와도 각자 제 줄까지 센다).
 * 🔴 한도를 넘은 시도는 **제 줄을 지운다**: 거절된 시도까지 남기면 ① 막힌 사람이 다시 누를 때마다 창이 늘어나 영영 안 풀리고
 *    ② 한 IP가 거절된 시도만으로 지점 전체 상한을 채워 모든 학생을 잠근다(적대 리뷰 2026-10-02). 지점 전체 상한은 통과한 조회만 센다.
 * 오래된 줄은 그때그때 지운다(cron 없이).
 */
async function admit(db: Db, tenantId: string, ipHash: string, kind: "lookup" | "open"): Promise<boolean> {
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const perIp = kind === "lookup" ? SITE_LOOKUPS_PER_HOUR : SITE_OPENS_PER_HOUR;
  const count = (scope: "ip" | "tenant") => {
    const base = db.from(ATTEMPTS).select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("kind", kind).gte("created_at", hourAgo);
    return scope === "ip" ? base.eq("ip_hash", ipHash) : base;
  };
  // 먼저 가볍게 센다 — 이미 한도를 채운 IP는 줄을 넣지도 않는다(넣었다 지우는 사이의 줄이 지점 전체 수에 잡혀
  // 물량으로 다른 학생을 밀어내지 못하게). 훑기 시도는 여기서 로그 한 줄로 남는다(줄을 안 남기므로).
  const already = await count("ip");
  if (already.error) throw new Error("시도 횟수 확인 실패");
  if ((already.count ?? 0) >= perIp) {
    console.warn(JSON.stringify({ level: "warn", scope: "videoSite.limit", kind, ip: ipHash.slice(0, 12) }));
    return false;
  }
  const inserted = await db.from(ATTEMPTS).insert({ tenant_id: tenantId, ip_hash: ipHash, kind }).select("id").single();
  if (inserted.error || !inserted.data) throw new Error("시도 기록 실패");
  const attemptId = (inserted.data as { id: string }).id;
  const [ip, tenant] = await Promise.all([count("ip"), kind === "lookup" ? count("tenant") : Promise.resolve(null)]);
  if (ip.error || tenant?.error) throw new Error("시도 횟수 확인 실패");
  // 하루 지난 시도는 지운다 — 실패해도 판정과 무관하다.
  void db.from(ATTEMPTS).delete().eq("tenant_id", tenantId).lt("created_at", new Date(Date.now() - 86_400_000).toISOString())
    .then(() => undefined, () => undefined);
  const over = (ip.count ?? 0) > perIp || (tenant?.count ?? 0) > SITE_LOOKUPS_PER_HOUR_TENANT;
  if (over) await db.from(ATTEMPTS).delete().eq("tenant_id", tenantId).eq("id", attemptId).then(() => undefined, () => undefined);
  return !over;
}

type Candidate = { studentId: string; classId: string; studentName: string; className: string };
type StudentRow = { id: string; name: string | null; grade: string | null; student_phone: string | null; parent_phone: string | null };
type EnrollmentRow = { student_id: string; class_id: string; start_date: string | null; end_date: string | null; on_hold: boolean | null; is_transferred: boolean | null };
type ClassRow = { id: string; class_name: string | null; subject: string | null };

/**
 * 뒷 4자리 + 이름 → 후보(학생 × 지금 다니는 반). 재원생만 · 학생 본인 번호 또는 보호자 번호가 그 4자리로 끝나고 **이름이 같은** 학생
 * (동명이인 구분 글자·공백은 무시 — `siteNameMatches`) · 그 반이 학원 설정의 영상 숙제 대상일 때만(영상 숙제를 안 쓰는 반은 올릴 곳이 아니다).
 * `tooMany` = 그 4자리에 학생이 너무 많다(자리 채움 번호 `0000` 등) — 번호가 확인 구실을 못 하므로 이름이 맞아도 사이트에서는 안내하지 않는다.
 * `matched` = 번호·이름이 맞는 학생이 있는가(반·숙제와 무관) — "찾지 못했다"와 "올릴 숙제가 없다"를 가르는 값.
 */
async function findCandidates(
  db: Db, tenantId: string, last4: string, name: string, day: string, settings: TenantSettings,
): Promise<{ tooMany: boolean; matched: boolean; list: Candidate[] }> {
  // DB에서는 그 4자리를 **포함**하는 번호로 넓게 받고(뒤에 "(모)" 같은 글자가 붙은 저장값도 걸리게), 숫자만 남겨 끝자리를 다시 본다.
  const { data: students, error } = await db.from("students")
    .select("id,name,grade,student_phone,parent_phone")
    .eq("tenant_id", tenantId).eq("status", "enrolled")
    .or(`student_phone.ilike.%${last4}%,parent_phone.ilike.%${last4}%`)
    .order("id", { ascending: true }).limit(LOOKUP_ROW_LIMIT + 1);
  if (error) throw new Error("학생 조회 실패");
  const rows = (students ?? []) as StudentRow[];
  if (rows.length > LOOKUP_ROW_LIMIT) return { tooMany: true, matched: false, list: [] };
  const byPhone = rows.filter((s) => phoneEndsWith(s.student_phone, last4) || phoneEndsWith(s.parent_phone, last4));
  if (!byPhone.length) return { tooMany: false, matched: false, list: [] };
  if (byPhone.length > SITE_MAX_STUDENTS_PER_LAST4) return { tooMany: true, matched: false, list: [] };
  const matched = byPhone.filter((s) => siteNameMatches(s.name, name));
  if (!matched.length) return { tooMany: false, matched: false, list: [] };
  const byId = new Map(matched.map((s) => [s.id, s]));
  const enrollments = await fetchInChunks<EnrollmentRow>([...byId.keys()], (chunk) => db.from("enrollments")
    .select("student_id,class_id,start_date,end_date,on_hold,is_transferred")
    .eq("tenant_id", tenantId).in("student_id", chunk));
  const live = enrollments.filter((e) => e.class_id && !e.on_hold && (!e.start_date || e.start_date <= day) && !isEnrollmentEndedOn(e.end_date, day, e.is_transferred === true));
  if (!live.length) return { tooMany: false, matched: true, list: [] };
  const classes = await fetchInChunks<ClassRow>([...new Set(live.map((e) => e.class_id))], (chunk) => db.from("classes")
    .select("id,class_name,subject").eq("tenant_id", tenantId).eq("is_active", true).in("id", chunk));
  const classById = new Map(classes.map((c) => [c.id, c]));
  const policy = settings.report.videoHomeworkPolicy;
  const out = new Map<string, Candidate>();
  for (const e of live) {
    const student = byId.get(e.student_id);
    const klass = classById.get(e.class_id);
    if (!student || !klass?.subject) continue;
    if (!isVideoHomeworkEnabled(policy, { classId: klass.id, subjectKey: klass.subject, grade: student.grade })) continue;
    out.set(`${student.id}:${klass.id}`, { studentId: student.id, classId: klass.id, studentName: student.name?.trim() || "학생", className: klass.class_name?.trim() || "수업" });
  }
  const list = [...out.values()].sort((a, b) => a.studentName.localeCompare(b.studentName, "ko") || a.className.localeCompare(b.className, "ko"));
  return { tooMany: false, matched: true, list };
}

type HomeworkChoice = Candidate & { homeworkDate: string };

/**
 * 후보(학생 × 반)마다 **아직 안 낸 영상 숙제**를 붙인다 — 최신 숙제부터, 상한까지. `null` = 영상 과제 값을 읽을 수 없다(잠시 못 받음).
 * 숙제가 하나도 없으면 빈 목록 — 올릴 길이 없다(원장 2026-10-03 *"사전에 선생님이 숙제로 낸 리스트가 있어야 업로드 링크 보이도록"*).
 */
async function homeworkChoices(db: Db, tenantId: string, list: Candidate[], day: string): Promise<HomeworkChoice[] | null> {
  if (!list.length) return [];
  const open = await openHomeworkDates(db, tenantId, list.map((c) => ({ studentId: c.studentId, classId: c.classId })), day);
  if (!open) return null;
  return list
    .flatMap((c) => (open.get(`${c.classId}:${c.studentId}`) ?? []).map((homeworkDate) => ({ ...c, homeworkDate })))
    .sort((a, b) => b.homeworkDate.localeCompare(a.homeworkDate) || a.className.localeCompare(b.className, "ko") || a.studentName.localeCompare(b.studentName, "ko"))
    .slice(0, SITE_MAX_CHOICES);
}

/**
 * 뒷 4자리 + 이름 조회 — 그 학생이 **지금 올릴 수 있는 영상 숙제**를 돌려준다(이름은 가운데를 가린 채 — 구분 글자가 다른 동명이인을 가를 때만 쓴다).
 * 번호·이름이 안 맞으면 "찾지 못했다", 맞는데 숙제가 없으면 "올릴 숙제가 없다" — 둘을 가른다. 🔴 가르는 값이 새는 것은 "그 이름의 학생이
 * 그 번호를 쓴다"뿐이고, 이름과 번호를 둘 다 맞혀야 나온다(횟수 제한 뒤). 반·숙제 내용은 숙제가 있을 때만 내려간다.
 */
export async function lookupSite(input: { last4: unknown; name: unknown; ip: string | null }): Promise<SiteLookupResult> {
  if (!isLast4(input.last4)) return { ok: false, code: "invalid", error: "휴대폰 번호 뒷 4자리(숫자 4개)를 입력해 주세요." };
  if (!isSiteName(input.name)) return { ok: false, code: "invalid", error: NAME_NEEDED };
  const db = createAdminClient();
  try {
    const site = await siteAvailability(db);
    if (!site.ok) return { ok: false, code: "unavailable", error: UNAVAILABLE };
    if (!(await admit(db, site.tenantId, ipHashOf(input.ip, site.tenantId), "lookup"))) return { ok: false, code: "limit", error: LIMITED };
    const day = kstToday();
    const found = await findCandidates(db, site.tenantId, input.last4, input.name, day, site.settings);
    if (found.tooMany) return { ok: false, code: "invalid", error: TOO_MANY };
    if (!found.matched) return { ok: false, code: "invalid", error: NOT_FOUND };
    const choices = await homeworkChoices(db, site.tenantId, found.list, day);
    if (!choices) return { ok: false, code: "unavailable", error: UNAVAILABLE };
    if (!choices.length) return { ok: false, code: "no_homework", error: NO_HOMEWORK };
    return {
      ok: true,
      choices: choices.map((c) => ({
        id: choiceId(site.tenantId, c.studentId, c.classId, c.homeworkDate, day),
        studentLabel: maskStudentName(c.studentName), className: c.className, homeworkLabel: formatShortKoreanDate(c.homeworkDate),
      })),
    };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", scope: "videoSite.lookup", message: error instanceof Error ? error.message : "unknown" }));
    return { ok: false, code: "error", error: FAILED };
  }
}

/**
 * 그 학생 × 반의 최근 사이트 링크 — **오늘 만든 것**(오래된 순, 끊긴 것 포함)과, **오늘 선생님이 끊은 것**이 있는지.
 * 끊김은 만든 날이 아니라 끊은 날로 본다: 어제 사이트로 연 링크(오늘까지 살아 있다)를 오늘 끊어도 그날은 사이트로 다시 못 연다.
 */
async function pairLinksToday(db: Db, tenantId: string, c: Candidate, day: string): Promise<{ todayIds: string[]; revokedToday: boolean }> {
  const dayStart = `${day}T00:00:00+09:00`;
  const { data, error } = await db.from("homework_video_links").select("id,created_at,revoked_at")
    .eq("tenant_id", tenantId).eq("student_id", c.studentId).eq("class_id", c.classId).eq("origin", "site")
    .gte("created_at", `${shareExpiryDate(day, -1)}T00:00:00+09:00`)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(SITE_LINKS_PER_PAIR_PER_DAY * 8);
  if (error) throw new Error("링크 수 확인 실패");
  const rows = (data ?? []) as Array<{ id: string; created_at: string; revoked_at: string | null }>;
  const startMs = Date.parse(dayStart);
  const onOrAfter = (iso: string | null) => !!iso && Date.parse(iso) >= startMs;
  return {
    todayIds: rows.filter((r) => onOrAfter(r.created_at)).map((r) => r.id),
    revokedToday: rows.some((r) => onOrAfter(r.revoked_at)),
  };
}

/**
 * 고른 숙제의 제출 링크를 만든다 — 서버가 **같은 뒷 4자리·이름으로 다시 조회**해 그 숙제가 실제로 그 안에 있을 때만(화면이 보낸 지문을 믿지 않는다).
 * 돌려주는 주소엔 고른 숙제일이 실린다(`?h=`) — 제출 화면과 업로드 시작이 그 값을 **다시 확인**해 영상을 그 숙제에 묶는다.
 * 링크는 만든 날과 다음 날까지. 한 학생 × 반이 하루에 만들 수 있는 수에 상한(링크마다 업로드 횟수 제한이 따로 있어, 새 링크로 우회하지 못하게).
 *  · 자정을 넘겨 고른 후보(어제 날짜 지문)도 받는다 — 23:59에 조회하고 00:00에 누른 학생이 막히지 않게.
 *  · 선생님이 오늘 그 학생 × 반의 사이트 링크를 끊었으면 그날은 사이트로 다시 열지 못한다('링크 끊기'가 사이트에도 효력을 갖게).
 *  · 상한은 **만든 뒤 다시 센다** — 동시에 여러 개를 보내 세기와 만들기 사이의 틈으로 상한을 넘지 못하게. 오늘 만든 줄을 오래된 순으로
 *    세워 **앞의 상한 개수 안에 든 링크만** 남긴다(서로를 보고 전부 지워 아무도 못 받는 일이 없게 — 정확히 상한만큼 남는다).
 */
export async function openSiteLink(input: { last4: unknown; name: unknown; choice: unknown; ip: string | null }): Promise<SiteOpenResult> {
  if (!isLast4(input.last4) || !isSiteName(input.name) || typeof input.choice !== "string" || !/^[0-9a-f]{40}$/.test(input.choice))
    return { ok: false, code: "invalid", error: STALE };
  const db = createAdminClient();
  try {
    const site = await siteAvailability(db);
    if (!site.ok) return { ok: false, code: "unavailable", error: UNAVAILABLE };
    if (!(await admit(db, site.tenantId, ipHashOf(input.ip, site.tenantId), "open"))) return { ok: false, code: "limit", error: LIMITED };
    const day = kstToday();
    const yesterday = shareExpiryDate(day, -1);
    const found = await findCandidates(db, site.tenantId, input.last4, input.name, day, site.settings);
    const choices = found.tooMany ? [] : await homeworkChoices(db, site.tenantId, found.list, day);
    if (!choices) return { ok: false, code: "unavailable", error: UNAVAILABLE };
    const picked = choices.find((c) => [day, yesterday].some((d) => choiceId(site.tenantId, c.studentId, c.classId, c.homeworkDate, d) === input.choice));
    if (!picked) return { ok: false, code: "invalid", error: STALE };
    const before = await pairLinksToday(db, site.tenantId, picked, day);
    if (before.revokedToday) return { ok: false, code: "limit", error: PAIR_BLOCKED };
    if (before.todayIds.length >= SITE_LINKS_PER_PAIR_PER_DAY) return { ok: false, code: "limit", error: PAIR_BLOCKED };
    const minted = await mintSubmitLink(db, {
      tenantId: site.tenantId, studentId: picked.studentId, classId: picked.classId, origin: "site", baseDate: day, expiresAt: siteLinkExpiresAt(day),
    });
    const after = await pairLinksToday(db, site.tenantId, picked, day);
    if (!after.todayIds.slice(0, SITE_LINKS_PER_PAIR_PER_DAY).includes(minted.id)) {
      // 동시에 들어온 요청이 함께 상한을 넘겼고 이 링크가 상한 밖이다 — 아무에게도 주지 않고 지운다.
      const removed = await db.from("homework_video_links").delete().eq("tenant_id", site.tenantId).eq("id", minted.id);
      if (removed.error) console.error(JSON.stringify({ level: "error", scope: "videoSite.open", message: "상한 밖 링크를 지우지 못했습니다" }));
      return { ok: false, code: "limit", error: PAIR_BLOCKED };
    }
    await logActionAs({ tenantId: site.tenantId, actorName: SITE_ACTOR }, {
      action: "lesson_report_video_link_issue", targetType: "student", targetLabel: `${picked.studentName} · ${picked.className}`,
      metadata: { studentId: picked.studentId, classId: picked.classId, origin: "site", lastDay: siteLinkLastDay(day), homeworkDate: picked.homeworkDate },
    });
    return { ok: true, url: `/v/${minted.token}?h=${picked.homeworkDate}` };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", scope: "videoSite.open", message: error instanceof Error ? error.message : "unknown" }));
    return { ok: false, code: "error", error: FAILED };
  }
}
