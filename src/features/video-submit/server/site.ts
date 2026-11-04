import "server-only";
import { createHash, createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { addDays, formatShortKoreanDate, kstDateOf, kstTimeOf, kstToday } from "@/lib/date-kst";
import { logActionAs } from "@/features/audit/server/log";
import type { TenantSettings } from "@/features/owner/settings-types";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import { shareExpiryDate } from "@/features/onescreen/share-expiry";
import { maskStudentName } from "../rules";
import {
  isLast4,
  isSiteName,
  phoneEndsWith,
  siteNameMatches,
  SITE_LINK_LOOKBACK_DAYS,
  siteLinkExpiresAt,
  SITE_LINKS_PER_PAIR_PER_DAY,
  SITE_LOOKUPS_PER_HOUR,
  SITE_LOOKUPS_PER_HOUR_TENANT,
  SITE_MAX_CHOICES,
  SITE_MAX_STUDENTS_PER_LAST4,
  SITE_OPENS_PER_HOUR,
  siteNoChoiceMessage,
  type SiteLookupResult,
  type SiteNoChoiceWhy,
  type SiteOpenResult,
} from "../site";
import { mintSubmitLink } from "./links";
import { resolveSiteRequest, SITE_ATTEMPTS_TABLE } from "./site-branches";
import { openHomeworkDates } from "./site-homework";
import { homeworkDueText, VIDEO_HOMEWORK_MAX_DUE_DAYS } from "@/features/video-homework/due";

type Db = ReturnType<typeof createAdminClient>;

/**
 * 숙제 영상 **올리기 사이트**(`/v`, 0330a) — 뒷 4자리 **+ 이름**으로 학생을 찾고, 선생님이 낸 **영상 숙제 중 아직 안 낸 것**을
 * 보여 준 뒤, 고른 숙제의 제출 링크를 그 자리에서 만든다(원장 2026-10-03). 숙제가 없으면 올릴 길이 없다.
 * 올리기 자체는 기존 제출 링크 길을 그대로 탄다(`/v/<토큰>?h=숙제일` · upload-start/complete — 형식·크기·횟수 제한·Drive 대조까지 같은 코드).
 *
 * 🔑 지점 = **숙제 영상 저장 폴더가 있는 지점**(지점마다 따로 정한다 — 2026-10-04). 주소에 지점을 넣지 않는다(멀티테넌트 C안):
 *    사이트를 쓸 수 있는 지점이 하나면 그 지점, 여럿이면 화면에서 고른다(자리 PIN과 같은 방식). 고르지 않은 요청을 한 지점으로 떨어뜨리지 않는다.
 * 🔴 로그인 없는 화면이다 — 모든 조회에 **고른 지점** 필터(admin은 RLS 우회, [[#104]]). 학생 후보·숙제 지문·횟수 제한이 전부 그 지점 안에서만 돈다.
 *    학생·반 번호는 화면에 내려보내지 않는다(고른 값은 지문으로만).
 * 🔴 실패 원문은 서버 로그에만. 화면엔 한글 한 줄.
 */
export const SITE_ACTOR = "숙제 영상 올리기 사이트(학생)";
// 어느 지점이 사이트를 쓰나·공개 요청의 지점 정하기는 한 모듈(site-branches.ts)에 모았다 — 옛 import 경로는 그대로 둔다.
export { _resetVideoSiteForTest, siteAvailability, siteDirectory, type ActiveSite, type SiteAvailability, type SiteDirectory } from "./site-branches";
const ATTEMPTS = SITE_ATTEMPTS_TABLE;
const UNAVAILABLE = "지금은 영상을 받을 수 없습니다. 선생님께 알려 주세요.";
const LIMITED = "잠시 동안 너무 많이 시도했습니다. 조금 뒤에 다시 해 주세요.";
const FAILED = "확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const NAME_NEEDED = "이름을 두 글자 이상 입력해 주세요.";
const NOT_FOUND = "번호와 이름이 맞는 학생을 찾지 못했습니다. 번호와 이름을 다시 확인하거나 선생님께 알려 주세요.";
// 번호·이름은 맞지만 고를 줄이 없다 — "찾지 못했다"와 가른다(원장 2026-10-03). 문구는 까닭을 가려 말한다(`siteNoChoiceMessage`, 원장 2026-11-04).
/** 숙제 없이 올리기 줄의 지문 자리(숙제일 대신) — 날짜 모양이 아니라 숙제 지문과 겹치지 않는다. */
const FREE = "free";
const TOO_MANY = "이 번호로는 여기서 찾을 수 없습니다. 숙제 영상은 ClassNote 알림장에 올려 주세요.";
const STALE = "시간이 지나 다시 확인이 필요합니다. 번호와 이름을 다시 입력해 주세요.";
const PAIR_BLOCKED = "오늘은 여기서 더 열 수 없습니다. 선생님께 알려 주세요.";
/** 끝자리 조회에서 받는 행의 상한 — 이보다 많이 걸리면 그 번호는 사이트에서 안내하지 않는다(조용히 자르지 않는다, B2). */
const LOOKUP_ROW_LIMIT = 200;

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

/** `past` = 수강이 끝난 반(반 이동 전 반 등) — 그 반에서 받은 숙제 줄만 세운다(숙제 없이 올리기 줄 없음). */
type Candidate = { studentId: string; classId: string; studentName: string; className: string; past?: true;
  /** 그 반 담임(`classes.teacher_id`) — 화면의 '선생님 → 반 → 숙제' 첫 단계(원장 2026-10-22). 학생의 담당만 나온다(후보 반의 담임). */
  teacherId: string | null; subject: string };
type StudentRow = { id: string; name: string | null; grade: string | null; student_phone: string | null; parent_phone: string | null };
type EnrollmentRow = { student_id: string; class_id: string; start_date: string | null; end_date: string | null; on_hold: boolean | null; is_transferred: boolean | null };
type ClassRow = { id: string; class_name: string | null; subject: string | null; is_active: boolean | null; teacher_id: string | null };

/**
 * 뒷 4자리 + 이름 → 후보(학생 × 지금 다니는 반). 재원생만 · 학생 본인 번호 또는 보호자 번호가 그 4자리로 끝나고 **이름이 같은** 학생
 * (동명이인 구분 글자·공백은 무시 — `siteNameMatches`) · 그 반이 학원 설정의 영상 숙제 대상일 때만(영상 숙제를 안 쓰는 반은 올릴 곳이 아니다).
 * **수강이 끝난 반**(`past`, 원장 2026-10-21 — 10/18 반 이동 학생이 그 주 숙제를 못 골라 새 반에 '숙제 없이' 올렸다)도 후보다: 그 반에서 받은 숙제가
 * 아직 마감 전이면 그 숙제는 올린다. 끝난 날이 가장 먼 마감(`VIDEO_HOMEWORK_MAX_DUE_DAYS`)보다 오래면 열린 숙제가 있을 수 없어 읽지 않는다.
 * 반이 그사이 닫혀도(비활성) 숙제는 그대로다 — 업로드 시작(`isAssignedHomeworkDate`)도 반 상태를 보지 않는다.
 * `tooMany` = 그 4자리에 학생이 너무 많다(자리 채움 번호 `0000` 등) — 번호가 확인 구실을 못 하므로 이름이 맞아도 사이트에서는 안내하지 않는다.
 * `matched` = 번호·이름이 맞는 학생이 있는가(반·숙제와 무관) — "찾지 못했다"와 "올릴 숙제가 없다"를 가르는 값.
 */
async function findCandidates(
  db: Db, tenantId: string, last4: string, name: string, day: string, settings: TenantSettings,
): Promise<{ tooMany: boolean; matched: boolean; list: Candidate[]; why?: SiteNoChoiceWhy }> {
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
  const started = (e: EnrollmentRow) => !!e.class_id && (!e.start_date || e.start_date <= day);
  const ended = (e: EnrollmentRow) => isEnrollmentEndedOn(e.end_date, day, e.is_transferred === true);
  const live = enrollments.filter((e) => started(e) && !e.on_hold && !ended(e));
  // 지금(휴원 포함) 그 반 수강이 있으면 끝난 수강으로 지난 반을 세우지 않는다 — 옮겼다 돌아와 그 반만 휴원한 학생(적대적 리뷰 2026-10-21).
  const current = new Set(enrollments.filter((e) => started(e) && !ended(e)).map((e) => `${e.student_id}:${e.class_id}`));
  const since = addDays(day, -VIDEO_HOMEWORK_MAX_DUE_DAYS);
  const past = enrollments.filter((e) => started(e) && !e.on_hold && !!e.end_date && e.end_date >= since && ended(e) && !current.has(`${e.student_id}:${e.class_id}`));
  // 아직 시작 전인 수강 — 고를 줄로는 세우지 않고, 고를 줄이 없을 때 "언제부터"를 말하는 데만 쓴다(원장 2026-11-04).
  const upcoming = enrollments.filter((e) => !!e.class_id && !started(e) && !e.on_hold && !ended(e));
  if (!live.length && !past.length && !upcoming.length) return { tooMany: false, matched: true, list: [] };
  const classes = await fetchInChunks<ClassRow>([...new Set([...live, ...past, ...upcoming].map((e) => e.class_id))], (chunk) => db.from("classes")
    .select("id,class_name,subject,is_active,teacher_id").eq("tenant_id", tenantId).in("id", chunk));
  const classById = new Map(classes.map((c) => [c.id, c]));
  const policy = settings.report.videoHomeworkPolicy;
  const out = new Map<string, Candidate>();
  let excludedNow = false;
  // 지금 다니는 반이 먼저 — 같은 반을 다시 다니면(끝난 수강 + 지금 수강) 지금 반으로 선다(숙제 없이 올리기 줄까지).
  // 지금 수강인데 반이 닫혔으면(반 폐지 당일 — 종료일이 오늘이라 아직 수강 중) 끝난 반처럼 받은 숙제만(적대적 리뷰 2026-10-21).
  for (const [rows, isPast] of [[live, false], [past, true]] as const) {
    for (const e of rows) {
      const student = byId.get(e.student_id);
      const klass = classById.get(e.class_id);
      if (!student || !klass?.subject || out.has(`${student.id}:${klass.id}`)) continue;
      if (!isVideoHomeworkEnabled(policy, { classId: klass.id, subjectKey: klass.subject, grade: student.grade })) {
        if (!isPast) excludedNow = true;
        continue;
      }
      out.set(`${student.id}:${klass.id}`, { studentId: student.id, classId: klass.id, studentName: student.name?.trim() || "학생",
        className: klass.class_name?.trim() || "수업", ...(isPast || !klass.is_active ? { past: true as const } : {}),
        teacherId: klass.teacher_id ?? null, subject: klass.subject });
    }
  }
  const list = [...out.values()].sort((a, b) => a.studentName.localeCompare(b.studentName, "ko") || a.className.localeCompare(b.className, "ko"));
  // 시작 전 반은 영상 숙제 대상이고 열린 반만 "그날부터 올릴 수 있다"고 말한다(대상 밖 반의 시작일을 약속하지 않는다).
  const nextStart = upcoming.filter((e) => {
    const student = byId.get(e.student_id);
    const klass = classById.get(e.class_id);
    return !!student && !!klass?.subject && klass.is_active !== false
      && isVideoHomeworkEnabled(policy, { classId: klass.id, subjectKey: klass.subject, grade: student.grade });
  }).map((e) => e.start_date!).sort()[0] ?? null;
  // 까닭은 학생 한 명일 때만 — 같은 이름·같은 4자리가 둘이면 한 학생의 시작일을 다른 학생에게 약속하게 된다(리뷰 2026-11-04).
  return { tooMany: false, matched: true, list, ...(matched.length === 1 ? { why: { excludedNow, nextStart } } : {}) };
}

/** 숙제 줄 — `due` = 그 숙제의 마감(그날 포함) · `next` = 선생님이 '다음 수업'으로 고른 마감(due.ts). */
type HomeworkChoice = Candidate & { homeworkDate: string; due: string; next: boolean; sent: number; videos: { postedAt: string; note: string | null }[] };
/** 고를 수 있는 줄 — 숙제(`homeworkDate`) 또는 숙제 없이 그 반에 올리기(`homeworkDate = null`). */
type PickChoice = Candidate & { homeworkDate: string | null; due?: string; next?: boolean; sent?: number; videos?: { postedAt: string; note: string | null }[] };

/**
 * 숙제 줄 + **숙제 없이 올리기** 줄(학생 × 반마다 하나, 원장 2026-10-13) — 숙제가 먼저, 그 아래 반 줄. 둘 다 같은 후보(번호·이름·
 * 영상 숙제 대상)에서만 나온다. 🔴 숙제 없이 올리기 줄은 **지금 다니는 반만**(끝난 반은 받은 숙제만 — 업로드 시작도 끝난 반의 숙제 없는 영상을 거절한다).
 * `null` = 영상 과제 값을 읽을 수 없다(잠시 못 받음).
 */
async function pickChoices(db: Db, tenantId: string, list: Candidate[], day: string): Promise<PickChoice[] | null> {
  const homework = await homeworkChoices(db, tenantId, list, day);
  if (!homework) return null;
  return [...homework, ...list.filter((c) => !c.past).slice(0, SITE_MAX_CHOICES).map((c) => ({ ...c, homeworkDate: null }))];
}

/**
 * 후보(학생 × 반)마다 **아직 올릴 수 있는 영상 숙제**를 붙인다 — 안 낸 숙제가 먼저(이미 낸 숙제가 상한 자리를 먹어 안 낸 숙제가 잘리지 않게 —
 * 한 숙제에 여러 개, 원장 2026-10-21), 그 안에서 최신 숙제부터, 상한까지. `null` = 영상 과제 값을 읽을 수 없다(잠시 못 받음).
 * 숙제가 하나도 없으면 빈 목록 — 올릴 길이 없다(원장 2026-10-03 *"사전에 선생님이 숙제로 낸 리스트가 있어야 업로드 링크 보이도록"*).
 */
async function homeworkChoices(db: Db, tenantId: string, list: Candidate[], day: string): Promise<HomeworkChoice[] | null> {
  if (!list.length) return [];
  const open = await openHomeworkDates(db, tenantId, list.map((c) => ({ studentId: c.studentId, classId: c.classId })), day);
  if (!open) return null;
  return list
    .flatMap((c) => (open.get(`${c.classId}:${c.studentId}`) ?? []).map((homework) => ({ ...c, homeworkDate: homework.date, due: homework.due, next: homework.next, sent: homework.sent, videos: homework.videos })))
    .sort((a, b) => Number(a.sent > 0) - Number(b.sent > 0) || b.homeworkDate.localeCompare(a.homeworkDate)
      || a.className.localeCompare(b.className, "ko") || a.studentName.localeCompare(b.studentName, "ko"))
    .slice(0, SITE_MAX_CHOICES);
}

/**
 * 뒷 4자리 + 이름 조회 — 그 학생이 **지금 올릴 수 있는 영상 숙제**를 돌려준다(이름은 가운데를 가린 채 — 구분 글자가 다른 동명이인을 가를 때만 쓴다).
 * 번호·이름이 안 맞으면 "찾지 못했다", 맞는데 숙제가 없으면 "올릴 숙제가 없다" — 둘을 가른다. 🔴 가르는 값이 새는 것은 "그 이름의 학생이
 * 그 번호를 쓴다"뿐이고, 이름과 번호를 둘 다 맞혀야 나온다(횟수 제한 뒤). ⚠️ 2026-10-13부터 숙제가 없어도 '숙제 없이 올리기' 줄로
 * 지금 다니는 반(영상 숙제 대상) 이름이 내려간다 — 이름과 번호를 둘 다 맞힌 사람에게만. '올릴 숙제가 없다'는 그런 반조차 없을 때다.
 */
export async function lookupSite(input: { last4: unknown; name: unknown; ip: string | null; tenant?: unknown }): Promise<SiteLookupResult> {
  if (!isLast4(input.last4)) return { ok: false, code: "invalid", error: "휴대폰 번호 뒷 4자리(숫자 4개)를 입력해 주세요." };
  if (!isSiteName(input.name)) return { ok: false, code: "invalid", error: NAME_NEEDED };
  const db = createAdminClient();
  try {
    const request = await resolveSiteRequest(db, input.tenant);
    if (!request.ok) return "unavailable" in request ? { ok: false, code: "unavailable", error: UNAVAILABLE } : request;
    const { site } = request;
    if (!(await admit(db, site.tenantId, ipHashOf(input.ip, site.tenantId), "lookup"))) return { ok: false, code: "limit", error: LIMITED };
    const day = kstToday();
    const found = await findCandidates(db, site.tenantId, input.last4, input.name, day, site.settings);
    if (found.tooMany) return { ok: false, code: "invalid", error: TOO_MANY };
    if (!found.matched) return { ok: false, code: "invalid", error: NOT_FOUND };
    const choices = await pickChoices(db, site.tenantId, found.list, day);
    if (!choices) return { ok: false, code: "unavailable", error: UNAVAILABLE };
    if (!choices.length) return { ok: false, code: "no_homework", error: siteNoChoiceMessage(found.why) };
    // 선생님 → 반 → 숙제(원장 2026-10-22 *"반이름도 반이름이지만 '선생님' 이름을 좀 잘보이게"* · *"선생님 선택 -> 반 선택 -> 숙제 선택"*).
    // 이름 = '내 정보'의 수업보고서 발송 이름(없으면 원래 이름 — 발송과 같은 규칙) + (과목). 화면엔 번호 대신 묶음 열쇠만 내려간다.
    const teacherNames = await siteTeacherNames(db, site.tenantId, [...new Set(found.list.flatMap((c) => (c.teacherId ? [c.teacherId] : [])))]);
    // 과목 라벨 한 줄 때문에 조회가 죽지 않게 — 설정이 비면 기본 설정의 과목표.
    const subjects = buildSubjectMaps(site.settings.operations?.subjects ?? DEFAULT_SETTINGS.operations.subjects);
    const teacherKeys = new Map<string, string>();
    const classKeys = new Map<string, string>();
    const keyOf = (map: Map<string, string>, raw: string, prefix: string) => map.get(raw) ?? map.set(raw, `${prefix}${map.size + 1}`).get(raw)!;
    return {
      ok: true,
      choices: choices.map((c) => ({
        id: choiceId(site.tenantId, c.studentId, c.classId, c.homeworkDate ?? FREE, day),
        studentLabel: maskStudentName(c.studentName), className: c.className,
        teacherKey: keyOf(teacherKeys, `${c.teacherId ?? "-"}:${c.subject}`, "t"),
        teacherLabel: siteTeacherLabel(c.teacherId ? teacherNames.get(c.teacherId) ?? null : null, subjectLabelOrNull(subjects.labelOf(c.subject), c.subject)),
        classKey: keyOf(classKeys, `${c.studentId}:${c.classId}`, "c"),
        homeworkLabel: c.homeworkDate ? formatShortKoreanDate(c.homeworkDate) : "",
        // 언제까지 내나(원장 2026-10-15 — 학생이 숙제일을 내는 날로 헷갈려 숙제 없이 올렸다). 마감은 날짜까지 정해져 있어 그대로 적는다.
        ...(c.homeworkDate && c.due ? { dueLabel: homeworkDueText(c.homeworkDate, c.next ? c.due : null, c.next) } : {}),
        ...(c.homeworkDate ? {} : { free: true as const }),
        ...(c.past ? { pastClass: true as const } : {}),
        ...(c.homeworkDate && c.sent ? { sent: c.sent } : {}),
        // 이미 낸 영상(원장 2026-10-22 *"어떤 영상이 이미 배정된 적이 있는지 … 본인이 입력한 멘트를 볼 수 있게"*) — 올린 시각 · 학생 메모만(파일·주소는 안 보낸다).
        ...(c.homeworkDate && c.videos?.length ? { sentVideos: c.videos.map((v) => ({
          label: `${formatShortKoreanDate(kstDateOf(v.postedAt) ?? v.postedAt.slice(0, 10))} ${kstTimeOf(v.postedAt)}`, ...(v.note ? { note: v.note } : {}) })) } : {}),
      })),
    };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", scope: "videoSite.lookup", message: error instanceof Error ? error.message : "unknown" }));
    return { ok: false, code: "error", error: FAILED };
  }
}

/**
 * 담임 선생님의 **수업보고서 발송 이름**(`users.report_display_name`, '내 정보' — 원장 2026-10-22 *"수업 보고서 발송 이름과 동일시"*) — 비면 원래 이름.
 * 후보 반의 담임만 읽는다(학생의 담당이 아닌 선생님 이름은 나가지 않는다). 칸이 없으면(0217a 전) 원래 이름 · 실패는 빈 맵(이름 없이 과목만).
 */
async function siteTeacherNames(db: Db, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  type Row = { id: string; display_name: string | null; report_display_name?: string | null };
  // 동적 select 문자열이라 행 모양을 추론하지 못한다 — 실은 모양을 적는다.
  const read = (select: string) => fetchInChunks<Row>(ids, (chunk) =>
    db.from("users").select(select).eq("tenant_id", tenantId).in("id", chunk) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>);
  let rows: Row[];
  try {
    rows = await read("id,display_name,report_display_name");
  } catch (e) {
    if (!/report_display_name/.test(e instanceof Error ? e.message : "")) return out;
    try { rows = await read("id,display_name"); } catch { return out; }
  }
  for (const r of rows) {
    const name = r.report_display_name?.trim() || r.display_name?.trim();
    if (name) out.set(r.id, name);
  }
  return out;
}

/** "허주연 (수학)" — 이름을 모르면 과목만("수학 선생님") · 과목도 모르면 "선생님"/이름만. */
function siteTeacherLabel(name: string | null, subjectLabel: string | null): string {
  if (name) return subjectLabel ? `${name} (${subjectLabel})` : name;
  return subjectLabel ? `${subjectLabel} 선생님` : "선생님";
}

/** 라벨을 못 찾아 내부 키(`math`·`subject_3`)가 그대로 돌아오면 쓰지 않는다 — 화면에 원문 키 노출 금지. */
function subjectLabelOrNull(label: string, key: string): string | null {
  return label && label !== key ? label : null;
}

/**
 * 그 학생 × 반의 최근 사이트 링크 — **오늘 만든 것**(오래된 순, 끊긴 것 포함)과, **오늘 선생님이 끊은 것**이 있는지.
 * 끊김은 만든 날이 아니라 끊은 날로 본다: 며칠 전 사이트로 연 링크(숙제 기한까지 살아 있다)를 오늘 끊어도 그날은 사이트로 다시 못 연다.
 * 🔴 살아 있을 수 있는 링크를 전부 읽는다(`SITE_LINK_LOOKBACK_DAYS` — 링크는 숙제의 마감까지 산다, 길어야 숙제일 + 14일). 하루에 만들 수 있는 수에 상한이 있어
 *    줄 수는 작다 — 상한을 넘으면 조용히 자르지 않고 던진다(오늘 줄이 잘려 하루 상한이 새면 안 된다).
 */
/** 한 학생 × 반의 살아 있을 수 있는 사이트 링크 줄 상한 — 하루 상한 × 거슬러 보는 날수보다 넉넉하다. */
const PAIR_LINK_ROWS = 200;
async function pairLinksToday(db: Db, tenantId: string, c: Candidate, day: string): Promise<{ todayIds: string[]; revokedToday: boolean }> {
  const dayStart = `${day}T00:00:00+09:00`;
  const { data, error } = await db.from("homework_video_links").select("id,created_at,revoked_at")
    .eq("tenant_id", tenantId).eq("student_id", c.studentId).eq("class_id", c.classId).eq("origin", "site")
    .gte("created_at", `${shareExpiryDate(day, -SITE_LINK_LOOKBACK_DAYS)}T00:00:00+09:00`)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(PAIR_LINK_ROWS + 1);
  if (error) throw new Error("링크 수 확인 실패");
  const rows = (data ?? []) as Array<{ id: string; created_at: string; revoked_at: string | null }>;
  if (rows.length > PAIR_LINK_ROWS) throw new Error("링크 수 확인 범위 초과");
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
 * 링크는 그 학생 × 반의 안 낸 숙제 중 마감이 가장 늦은 것까지(due.ts — 기본 숙제일 + 7일) — 숙제마다의 마감은 업로드 시작이 따로 막는다.
 * 한 학생 × 반이 하루에 만들 수 있는 수에 상한(링크마다 업로드 횟수 제한이 따로 있어, 새 링크로 우회하지 못하게).
 *  · 자정을 넘겨 고른 후보(어제 날짜 지문)도 받는다 — 23:59에 조회하고 00:00에 누른 학생이 막히지 않게.
 *  · 선생님이 오늘 그 학생 × 반의 사이트 링크를 끊었으면 그날은 사이트로 다시 열지 못한다('링크 끊기'가 사이트에도 효력을 갖게).
 *  · 상한은 **만든 뒤 다시 센다** — 동시에 여러 개를 보내 세기와 만들기 사이의 틈으로 상한을 넘지 못하게. 오늘 만든 줄을 오래된 순으로
 *    세워 **앞의 상한 개수 안에 든 링크만** 남긴다(서로를 보고 전부 지워 아무도 못 받는 일이 없게 — 정확히 상한만큼 남는다).
 */
export async function openSiteLink(input: { last4: unknown; name: unknown; choice: unknown; ip: string | null; tenant?: unknown }): Promise<SiteOpenResult> {
  if (!isLast4(input.last4) || !isSiteName(input.name) || typeof input.choice !== "string" || !/^[0-9a-f]{40}$/.test(input.choice))
    return { ok: false, code: "invalid", error: STALE };
  const db = createAdminClient();
  try {
    const request = await resolveSiteRequest(db, input.tenant);
    if (!request.ok) return "unavailable" in request ? { ok: false, code: "unavailable", error: UNAVAILABLE } : request;
    const { site } = request;
    if (!(await admit(db, site.tenantId, ipHashOf(input.ip, site.tenantId), "open"))) return { ok: false, code: "limit", error: LIMITED };
    const day = kstToday();
    const yesterday = shareExpiryDate(day, -1);
    const found = await findCandidates(db, site.tenantId, input.last4, input.name, day, site.settings);
    const choices = found.tooMany ? [] : await pickChoices(db, site.tenantId, found.list, day);
    if (!choices) return { ok: false, code: "unavailable", error: UNAVAILABLE };
    const picked = choices.find((c) => [day, yesterday].some((d) => choiceId(site.tenantId, c.studentId, c.classId, c.homeworkDate ?? FREE, d) === input.choice));
    if (!picked) return { ok: false, code: "invalid", error: STALE };
    const before = await pairLinksToday(db, site.tenantId, picked, day);
    if (before.revokedToday) return { ok: false, code: "limit", error: PAIR_BLOCKED };
    if (before.todayIds.length >= SITE_LINKS_PER_PAIR_PER_DAY) return { ok: false, code: "limit", error: PAIR_BLOCKED };
    // 링크는 그 학생 × 반의 안 낸 숙제 중 **마감이 가장 늦은 것**까지 산다(고른 숙제가 그중 하나다 — 마감은 숙제마다 다를 수 있다, due.ts).
    // 숙제 없이 올리기만 있는 반은 오늘 하루(다음 날 0시까지) — 숙제가 있으면 그 마감까지(같은 링크로 숙제도 올린다).
    const lastDue = choices.filter((c) => c.studentId === picked.studentId && c.classId === picked.classId && c.homeworkDate && c.due)
      .reduce<string | null>((max, c) => (!max || c.due! > max ? c.due! : max), null);
    const lastDay = lastDue ?? day;
    const minted = await mintSubmitLink(db, {
      tenantId: site.tenantId, studentId: picked.studentId, classId: picked.classId, origin: "site", baseDate: day, expiresAt: siteLinkExpiresAt(lastDay),
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
      metadata: { studentId: picked.studentId, classId: picked.classId, origin: "site", lastDay,
        ...(picked.homeworkDate ? { homeworkDate: picked.homeworkDate } : { free: true }) },
    });
    return { ok: true, url: picked.homeworkDate ? `/v/${minted.token}?h=${picked.homeworkDate}` : `/v/${minted.token}?free=1` };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", scope: "videoSite.open", message: error instanceof Error ? error.message : "unknown" }));
    return { ok: false, code: "error", error: FAILED };
  }
}
