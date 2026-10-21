import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { addDays } from "@/lib/date-kst";
import { buildLedgerRounds, roundPairKey, videoArrivedAt, videoFingerprint, videoMatchRange, type RoundOwners } from "@/features/video-homework/rounds";
import { videoHomeworkColumnReady } from "@/features/video-homework/server/assignments";
import { isVideoHomeworkDate, type VideoArrival, type VideoHomeworkMark, type VideoHomeworkStatus } from "@/features/video-homework/types";
import { homeworkVideoLinks } from "@/features/students/homework-videos";
import { homeworkDue, homeworkOpen, isCustomDue, VIDEO_HOMEWORK_MAX_DUE_DAYS } from "@/features/video-homework/due";
import { videoHomeworkDueColumnReady } from "@/features/video-homework/server/report-due";
import { homeworkVideoSource } from "@/features/video-homework/server/video-source";
import { findExtraIssue, listExtraIssuesFor } from "@/features/video-homework/server/extra-issues";
import { listRejections, rejectionsByPair } from "@/features/video-homework/server/rejections";
import { SITE_MAX_VIDEOS_PER_HOMEWORK } from "../site";

type Db = ReturnType<typeof createAdminClient>;
export type HomeworkPair = { studentId: string; classId: string };
/**
 * 아직 올릴 수 있는 숙제 — 숙제일 · 그 숙제의 마감(그날 포함, due.ts) · 선생님이 '다음 수업'으로 고른 마감인가(학생 화면 문구) ·
 * 이미 낸 영상 수(`sent` — 장부 칸의 `videoIds`와 같은 수. 0이면 아직 안 냄).
 */
export type OpenHomework = { date: string; due: string; next: boolean; sent: number;
  /** 상한(`SITE_MAX_VIDEOS_PER_HOMEWORK`)에 세는 수 — `sent` + 그 숙제를 골라 낸 같은 파일 사본(같은 파일을 되풀이해 올려 상한을 풀지 못하게). */
  used: number };

/**
 * 한 조회가 받는 행의 상한 — 학생 몇 명의 70여 일치라 닿을 일이 없다. 닿으면 조용히 자르지 않고 던진다(B2).
 * 🔴 PostgREST는 1,000행에서 자른다 — 그보다 큰 상한은 걸릴 수 없는 가드다. 상한보다 한 줄 더 받아 "넘쳤다"를 본다.
 */
const ROW_LIMIT = 500;

/**
 * 그 학생 × 반에 선생님이 낸 **영상 숙제 중 아직 올릴 수 있는 것**(숙제일, 최신순) — 원장 2026-10-03 *"사전에 선생님이 숙제로 낸 리스트가
 * 있어야 업로드 링크 보이도록 하고, 숙제 리스트에서 고르도록"*.
 *
 * 🔑 판정은 영상 제출 현황과 **같은 함수**(`buildLedgerRounds`)다 — 숙제 = 보고서의 '영상 과제 있음'(`video_homework = true`),
 *    낸 영상 = 그 칸에 보이는 영상(`videoIds`). 재료도 같은 범위(`videoMatchRange`)로 읽어야 "가장 오래된 미확인 숙제부터"의
 *    짝이 장부와 같게 나온다(범위가 다르면 사이트와 장부가 낸 영상 수를 다르게 센다).
 *  · 올릴 수 있는 숙제 = 오늘이 그 숙제의 **마감** 이하(due.ts — 기본 숙제일 + 7일(원장 2026-10-03 *"숙제날짜 기준 7일"*) · 선생님이 '다음 수업'을
 *    고르면 그 수업일, 원장 2026-10-15). 마감은 장부가 영상을 그 숙제로 세는 창(`VIDEO_MATCH_WINDOW_DAYS`, 2주)을 넘지 않아 사이트로 올린 영상은
 *    늘 그 숙제 칸에 닿는다.
 *  · **영상을 낸 숙제도 마감까지 남는다**(원장 2026-10-21 *"한번에 여러 단원의 영상을 업로드해야할 수도"* — 10/13의 "이미 낸 숙제엔 다시 안 올린다"를
 *    뒤집었다). 칸은 첫 영상에 바로 완료가 되고, 같은 숙제에 낸 영상은 그 칸에 더해진다(rounds.ts ③). 한 숙제에 낸 영상이
 *    `SITE_MAX_VIDEOS_PER_HOMEWORK`개면 뺀다(더 올릴 영상은 숙제 없이 올리기). 화면의 낸 수(`sent`)는 같은 파일을 한 번만 세지만(장부와 같다)
 *    상한(`used`)은 그 숙제를 골라 낸 사본까지 센다 — 같은 파일을 되풀이해 올려 상한을 풀지 못하게(적대적 리뷰 2026-10-21).
 *  · 미수행(✕)으로 찍힌 숙제도 목록에 선다(늦게라도 올릴 수 있다 — 칸의 표시는 선생님이 찍은 기록이 그대로 이긴다).
 * 🔴 로그인 없는 화면이 부른다 — 전부 그 지점·그 학생·그 반으로 좁힌다(admin은 RLS를 우회한다, [[#104]]).
 * `null` = 보고서의 영상 과제 칸을 읽을 수 없다(0308a 전, [[#95]]) — 호출부는 "지금은 받을 수 없다"로 닫는다(숙제 없음으로 읽지 않는다).
 * 영상 표를 못 읽으면 영상 없이 판정한다(장부와 같다 — 이미 낸 숙제가 목록에 남을 수 있을 뿐이다).
 * 영상도 그 반으로 분류된 것만 받는다(다른 과목 반에 올린 영상이 행 상한을 먹지 않게 — 다른 반 영상은 이 반 칸에 안 붙고, 같은 파일 판정도 반 × 학생 단위다).
 */
export async function openHomeworkDates(db: Db, tenantId: string, pairs: readonly HomeworkPair[], today: string): Promise<Map<string, OpenHomework[]> | null> {
  const out = new Map<string, OpenHomework[]>();
  if (!pairs.length) return out;
  const materials = await loadPairRoundMaterials(db, tenantId, pairs, today);
  if (!materials) return null;
  const rounds = pairRounds(materials);
  // `반:학생:숙제일` → 그 숙제를 골라(또는 손으로 배정해) 낸 영상 — 같은 파일 사본까지.
  const pickedTo = new Map<string, Set<string>>();
  for (const v of materials.videos) if (v.classId && v.homeworkDate) {
    const k = `${roundPairKey({ classId: v.classId, studentId: v.studentId })}:${v.homeworkDate}`;
    (pickedTo.get(k) ?? pickedTo.set(k, new Set()).get(k)!).add(v.id);
  }
  for (const p of pairs) {
    const key = roundPairKey(p);
    const dates = (rounds.get(key) ?? [])
      .filter((round) => (round.assigned || round.kept) && !!round.homeworkDate && homeworkOpen(round.homeworkDate, today, round.due))
      .map((round) => ({ date: round.homeworkDate!, due: homeworkDue(round.homeworkDate!, round.due), next: isCustomDue(round.homeworkDate!, round.due),
        sent: round.videoIds.length, used: new Set([...round.videoIds, ...(pickedTo.get(`${key}:${round.homeworkDate}`) ?? [])]).size }))
      .filter((homework) => homework.used < SITE_MAX_VIDEOS_PER_HOMEWORK)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (dates.length) out.set(key, dates);
  }
  return out;
}

/** 숙제 칸 판정 재료(그 학생 × 반들) — 숙제(보고서 ∪ 따로 낸 숙제) · 기록 · 그 반으로 분류된 업로드 완료 영상. */
export type PairRoundMaterials = {
  pairs: readonly HomeworkPair[]; from: string; today: string;
  assigned: Map<string, Set<string>>; marks: VideoHomeworkMark[]; videos: VideoArrival[];
  /** 반려한 숙제(`반:학생` → 숙제일 → 반려 시각) — 장부와 같은 칸이 서게(rounds.ts ②). */
  rejected: Map<string, Record<string, string>>;
  /** `assigned` 중 검사 기록 칸에서 옮겨 남긴 숙제(keep-round.ts) — 장부와 같게 검사 기록 칸처럼 짠다(rounds.ts `kept`). */
  kept?: Map<string, Set<string>>;
  /** 보고서에 고른 마감('다음 수업' — `반:학생` → 숙제일 → 마감, due.ts). 없는 숙제는 숙제일 + 7일. */
  dues?: Map<string, Record<string, string>>;
};

/** 재료 → 숙제 칸(장부와 같은 `buildLedgerRounds`). `owners`를 넘기면 칸마다 센 영상을 채운다(반려가 쓴다). */
export function pairRounds(m: PairRoundMaterials, owners?: RoundOwners) {
  return buildLedgerRounds({
    rows: m.pairs.map((p) => ({ classId: p.classId, studentId: p.studentId, assignedDates: [...(m.assigned.get(roundPairKey(p)) ?? [])].sort(), tracked: true,
      rejected: m.rejected.get(roundPairKey(p)), kept: [...(m.kept?.get(roundPairKey(p)) ?? [])], dues: m.dues?.get(roundPairKey(p)) })),
    marks: m.marks, videos: m.videos, fromDate: m.from, toDate: m.today, owners,
  });
}

/**
 * `openHomeworkDates`·반려(`reject-videos.ts`)가 같이 쓰는 재료 읽기. `from` = 칸을 볼 첫 날(기본 = 마감이 가장 먼 숙제의 숙제일 —
 * 오늘 - `VIDEO_HOMEWORK_MAX_DUE_DAYS`. 마감이 지난 숙제는 `openHomeworkDates`가 거른다).
 * `null` = 보고서의 영상 과제 칸을 읽을 수 없다(0308a 전, [[#95]]).
 */
export async function loadPairRoundMaterials(db: Db, tenantId: string, pairs: readonly HomeworkPair[], today: string,
  options: { from?: string } = {}): Promise<PairRoundMaterials | null> {
  const [ready, dueReady] = await Promise.all([videoHomeworkColumnReady(db), videoHomeworkDueColumnReady(db)]);
  if (!ready) return null;
  const students = [...new Set(pairs.map((p) => p.studentId))];
  const classes = [...new Set(pairs.map((p) => p.classId))];
  const wanted = new Set(pairs.map(roundPairKey));
  const from = options.from ?? addDays(today, -VIDEO_HOMEWORK_MAX_DUE_DAYS);
  const wide = videoMatchRange(from, today, today);
  const videoSource = await homeworkVideoSource(db);
  const [reports, extra, marks, videos, rejections] = await Promise.all([
    db.from("lesson_reports").select(dueReady ? "student_id,class_id,report_date,video_homework_due" : "student_id,class_id,report_date")
      .eq("tenant_id", tenantId).eq("video_homework", true).in("student_id", students).in("class_id", classes)
      .gte("report_date", wide.from).lt("report_date", addDays(today, 1)).order("id", { ascending: true }).limit(ROW_LIMIT + 1),
    // 보고서 없이 따로 낸 숙제(원장 2026-10-13)도 같은 숙제다 — 학생이 골라 올릴 수 있어야 한다.
    listExtraIssuesFor(db, tenantId, { studentIds: students, classIds: classes, fromDate: wide.from, toDate: today, limit: ROW_LIMIT + 1 }),
    db.from("video_homework_marks").select("class_id,student_id,check_date,homework_date,submitted_date,status,updated_at")
      .eq("tenant_id", tenantId).in("student_id", students).in("class_id", classes)
      .gte("check_date", wide.from).order("id", { ascending: true }).limit(ROW_LIMIT + 1),
    db.from(videoSource).select("id,student_id,post_id,posted_at,created_at,uploaded_at,md5,bytes,route,drive_file_id")
      .eq("tenant_id", tenantId).in("student_id", students).in("route->>classId", classes)
      .eq("status", "uploaded").not("drive_file_id", "is", null)
      .or(`posted_at.gte.${wide.from}T00:00:00+09:00,route->>manualAssignment.eq.true`).order("id", { ascending: true }).limit(ROW_LIMIT + 1),
    listRejections(db, tenantId, { studentIds: students, fromDate: wide.from, toDate: today }),
  ]);
  if (reports.error) throw new Error("영상 숙제 조회 실패");
  if (marks.error) throw new Error("영상 숙제 기록 조회 실패");
  const reportRows = (reports.data ?? []) as unknown as Array<{ student_id: string; class_id: string | null; report_date: string; video_homework_due?: string | null }>;
  const markRows = (marks.data ?? []) as Array<{ class_id: string; student_id: string; check_date: string; homework_date: string | null;
    submitted_date: string | null; status: string; updated_at: string | null }>;
  const videoRows = videos.error ? [] : ((videos.data ?? []) as Array<{ id: string; student_id: string; post_id?: number | null; posted_at: string;
    created_at?: string | null; uploaded_at?: string | null; md5?: string | null; bytes?: number | string | null; route: unknown; drive_file_id: string | null }>);
  if (reportRows.length > ROW_LIMIT || extra.length > ROW_LIMIT || markRows.length > ROW_LIMIT || videoRows.length > ROW_LIMIT) throw new Error("영상 숙제 조회 범위 초과");

  const assigned = new Map<string, Set<string>>();
  const kept = new Map<string, Set<string>>();
  const dues = new Map<string, Record<string, string>>();
  for (const r of reportRows) {
    if (!r.class_id || !isCustomDue(r.report_date, r.video_homework_due)) continue;
    const key = roundPairKey({ classId: r.class_id, studentId: r.student_id });
    if (wanted.has(key)) dues.set(key, { ...(dues.get(key) ?? {}), [r.report_date]: r.video_homework_due });
  }
  const add = (map: Map<string, Set<string>>, key: string, date: string) => (map.get(key) ?? map.set(key, new Set()).get(key)!).add(date);
  const issued = [...reportRows.map((r) => ({ classId: r.class_id, studentId: r.student_id, date: r.report_date })), ...extra.filter((x) => !x.kept)];
  for (const r of issued) {
    if (!r.classId) continue;
    const key = roundPairKey({ classId: r.classId, studentId: r.studentId });
    if (wanted.has(key)) add(assigned, key, r.date);
  }
  // 옮겨 남긴 숙제 — 같은 날 정식 숙제가 있으면 정식 숙제 쪽(장부 `getAssignedVideoHomework`와 같다).
  for (const x of extra.filter((issue) => issue.kept)) {
    const key = roundPairKey(x);
    if (wanted.has(key) && !assigned.get(key)?.has(x.date)) { add(assigned, key, x.date); add(kept, key, x.date); }
  }
  const videoArrivals = videoRows.flatMap((row): VideoArrival[] => {
    const route = row.route && typeof row.route === "object" && !Array.isArray(row.route) ? (row.route as Record<string, unknown>) : {};
    const links = homeworkVideoLinks(row.drive_file_id);
    if (!links || route.excluded === true) return [];
    const classId = typeof route.classId === "string" ? route.classId : null;
    const picked = typeof route.homeworkDate === "string" && route.homeworkDate ? route.homeworkDate : null;
    const arrivedAt = videoArrivedAt({ createdAt: row.created_at, postedAt: row.posted_at, uploadedAt: row.uploaded_at, fromClassnote: row.post_id != null, picked: !!picked });
    return classId ? [{ id: row.id, studentId: row.student_id, classId, postedAt: row.posted_at, arrivedAt, createdAt: row.created_at ?? null, homeworkDate: picked,
      playback: { ...links, uploadedAt: row.uploaded_at ?? null },
      manuallyAssigned: route.manualAssignment === true, free: route.free === true,
      fingerprint: videoFingerprint(row.md5, row.bytes) }] : [];
  });
  return {
    pairs, from, today, assigned, kept, dues, videos: videoArrivals,
    rejected: new Map([...rejectionsByPair(rejections)].filter(([key]) => wanted.has(key))),
    marks: markRows.map((row): VideoHomeworkMark => ({ classId: row.class_id, studentId: row.student_id, checkDate: row.check_date,
      homeworkDate: row.homework_date, submittedDate: row.submitted_date ?? null, status: row.status as VideoHomeworkStatus, updatedAt: row.updated_at })),
  };
}

/**
 * 그날이 그 학생 × 반에 **실제로 나간 영상 숙제**이고 아직 그 숙제의 마감(due.ts — 기본 숙제일 + 7일) 안인가 — 업로드 시작·제출 화면이 주소의 숙제일을
 * 그대로 믿지 않고 여기서 다시 확인한다. 이미 낸 숙제여도 참이다 — 한 숙제에 낸 영상 수의 상한은 따로 본다(`openHomeworkDates` — 업로드 시작·제출
 * 화면이 상한에 닿은 숙제엔 더 올리지 않고 숙제 없이 올리기로 보낸다, 원장 2026-10-21).
 * 🔴 영상 과제 칸을 읽을 수 없으면(0308a 전·순간 오류) **던진다** — "숙제가 아니다"로 읽으면 올리기 사이트 링크가 "숙제를 다시 고르라"며
 *    학생을 돌려보낸다(조회 쪽은 같은 상황을 "지금은 받을 수 없다"로 닫는다 — 같은 원칙).
 */
export async function isAssignedHomeworkDate(db: Db, tenantId: string, pair: HomeworkPair, date: unknown, today: string): Promise<boolean> {
  if (typeof date !== "string" || !isVideoHomeworkDate(date)) return false;
  if (date > today || date < addDays(today, -VIDEO_HOMEWORK_MAX_DUE_DAYS)) return false;
  const [ready, dueReady] = await Promise.all([videoHomeworkColumnReady(db), videoHomeworkDueColumnReady(db)]);
  if (!ready) throw new Error("영상 과제 값을 읽을 수 없습니다");
  const [{ data, error }, extra] = await Promise.all([
    db.from("lesson_reports").select(dueReady ? "id,video_homework_due" : "id")
      .eq("tenant_id", tenantId).eq("student_id", pair.studentId).eq("class_id", pair.classId)
      .eq("report_date", date).eq("video_homework", true).limit(1),
    findExtraIssue(db, tenantId, { classId: pair.classId, studentId: pair.studentId, date }),
  ]);
  if (error) throw new Error("영상 숙제 확인 실패");
  const report = ((data ?? []) as unknown as { video_homework_due?: string | null }[])[0];
  // 보고서의 마감이 먼저다(따로 낸 숙제는 7일 — 같은 날 둘 다 있으면 보고서 쪽, 장부 `getAssignedVideoHomework`와 같다).
  if (report) return homeworkOpen(date, today, report.video_homework_due);
  return extra !== null && homeworkOpen(date, today);
}
