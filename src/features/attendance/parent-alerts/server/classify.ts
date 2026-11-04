import "server-only";
import { batchesByTenant } from "../batch-by-tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateJSON } from "@/lib/ai/generate";
import { kstToday } from "@/lib/date-kst";
import { fetchInChunks } from "@/lib/supabase/batch";
import { sendPushToUsers } from "@/lib/push/web-push";
import {
  ATTENDANCE_ALERT_TYPE,
  buildAttendanceAlert,
  buildClassifyPrompt,
  isAttendanceIntent,
  normalizeIntent,
  type ParentIntent,
} from "../intent";
import { crossTeacherIds, mergeAlertTargets } from "../alert-targets";

/**
 * 학부모 연락(클래스노트) 중 **출결 통보만 골라** 토글 켠 계정에 알린다.
 *
 * 왜 앱이 하나(워커가 아니라): ① 모든 AI(JSON) 호출은 `generateJSON()` 단일 진입점을 거쳐야 하고
 * (CLAUDE.md) 그건 앱 코드다 ② 연동 PC(워커)에 AI API 키를 두지 않는다.
 * 워커는 원문만 `classnote_parent_messages`에 넣고 이 함수를 **킥**한다(내부 API). 킥이 실패해도
 * 행은 미분류로 남아 다음 폴에서 다시 잡히므로 유실되지 않는다.
 *
 * ⚠️ **페이지 로드로는 절대 안 돈다** — AI는 명시 트리거만(CLAUDE.md). 트리거는 워커 킥뿐이고,
 *    화면은 이미 저장된 분류 결과를 읽기만 한다.
 */

/** 한 번에 처리할 최대 건수 — 하루 물량이 수십 건이라 여유롭다(밀린 경우 다음 킥이 이어 받는다). */
const MAX_PER_RUN = 60;
/** 한 프롬프트에 넣는 건수 — 너무 크면 모델이 뒤쪽을 흘린다. */
const BATCH = 12;
/**
 * 알림을 보낼 **연락의 유효기간**(일). 이보다 오래된 건 분류돼 있어도 벨을 울리지 않고 조용히 소인한다.
 *
 * 🔴 없으면 **벨 폭탄**이 된다: 토글은 나중에 켜질 수 있는데(차량팀 계정을 며칠 뒤 켠다든지), 그 시점에
 * `notified_at`이 빈 과거 출결 연락이 통째로 남아 있으면 켜자마자 수십 건이 한꺼번에 쏟아진다.
 * 게다가 지난주 결석 통보는 셔틀에 아무 쓸모가 없다 — 인바운드 폴러의 age 가드와 같은 취지.
 */
const ALERT_MAX_AGE_DAYS = 2;

type PendingRow = {
  id: string;
  tenant_id: string;
  content: string;
  posted_at: string | null;
  created_at: string;
  student_id: string | null;
};

/** 알림 스윕이 읽는 행 — 분류 결과 + 함께 알릴 다른 과목 담당(0331a, 칸이 없는 DB에선 undefined). */
type NotifyRow = PendingRow & {
  /** 원문 종류 'post'(글 작성) · 'comment'(댓글) · 원문이 올라온 ClassNote 반 이름 — 벨 본문 앞머리(0184a부터 있는 칸). */
  source?: string | null;
  class_name?: string | null;
  category: string;
  starts_on: string | null;
  ends_on: string | null;
  detail: string | null;
  cross_teacher_ids?: unknown;
};

type ModelResult = { results?: Array<Record<string, unknown>> };

export type ClassifyOutcome = { scanned: number; classified: number; attendance: number; notified: number; failed: number };

/** 연락일(KST) — 상대 표현("오늘")을 푸는 축이라 반드시 KST로 잡는다. */
function messageDateOf(row: PendingRow): string {
  return kstToday(new Date(row.posted_at ?? row.created_at));
}

export async function classifyPendingParentMessages(tenantId?: string): Promise<ClassifyOutcome> {
  const db = createAdminClient();
  const out: ClassifyOutcome = { scanned: 0, classified: 0, attendance: 0, notified: 0, failed: 0 };

  let pendingQuery = db
    .from("classnote_parent_messages")
    .select("id, tenant_id, content, posted_at, created_at, student_id")
    .is("classified_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (tenantId) pendingQuery = pendingQuery.eq("tenant_id", tenantId);
  const { data: pending, error } = await pendingQuery;
  if (error) throw new Error(`미분류 학부모 연락 조회 실패: ${error.message}`);

  const rows = (pending ?? []) as PendingRow[];
  out.scanned = rows.length;
  if (!rows.length) return out;

  // 학생 이름 — 프롬프트가 "누구 얘기인지"를 알아야 "연재는 못 간대요" 같은 문장을 제대로 읽는다.
  const studentIds = [...new Set(rows.map((r) => r.student_id).filter((v): v is string => !!v))];
  const students = await fetchInChunks(studentIds, (chunk) =>
    db.from("students").select("id, name").in("id", chunk),
  );
  const nameOf = new Map((students ?? []).map((s) => [s.id as string, (s.name as string) ?? ""]));

  // 🔴 배치는 **지점별로** 끊는다 — 이 조회는 admin이라 전 지점의 미분류 글을 함께 받는다. 그대로 자르면 프롬프트 한 장에
  //    두 지점의 학부모 글이 섞이고 사용량이 첫 행의 지점으로만 찍힌다(감사 2026-09-21).
  for (const batch of batchesByTenant(rows, BATCH)) {
    let parsed: ModelResult | null = null;
    let model = "";
    try {
      const res = await generateJSON<ModelResult>({
        provider: "anthropic", // 2026-10-26 원장 "딥시크로 바꾼거 다 클로드로" — Sonnet 5.5(기본 등급). 막히면 사다리로 DeepSeek
        maxTokens: 4096,
        // 배치는 지점별로 끊겨 있어 첫 행의 지점이 곧 배치의 지점이다. 비면 generateJSON이 거절 → 이 배치만 실패로 남는다.
        meta: { feature: "parent_attendance_intent", tenantId: batch[0]?.tenant_id ?? "" },
        prompt: buildClassifyPrompt(
          batch.map((r) => ({
            id: r.id,
            studentName: nameOf.get(r.student_id ?? "") ?? "",
            date: messageDateOf(r),
            content: r.content,
          })),
        ),
      });
      parsed = res.data;
      model = res.model;
    } catch (e) {
      // 이 배치만 실패 표시 — 다음 킥에서 다시 잡히도록 classified_at은 **찍지 않는다**.
      out.failed += batch.length;
      const message = e instanceof Error ? e.message : String(e);
      await db
        .from("classnote_parent_messages")
        .update({ classify_error: message.slice(0, 300) })
        .in("id", batch.map((r) => r.id));
      continue;
    }

    const byId = new Map<string, Record<string, unknown>>();
    for (const r of parsed?.results ?? []) {
      const id = String((r as { id?: unknown }).id ?? "");
      if (id) byId.set(id, r);
    }

    for (const row of batch) {
      // 모델이 그 건을 통째로 빠뜨렸으면 **알리지 않는 쪽**으로 확정한다(none). 다시 물어도 같은 자리에서
      // 또 빠질 수 있고, 미분류로 남기면 매 킥마다 같은 건을 재호출해 비용만 는다.
      const intent: ParentIntent = normalizeIntent(byId.get(row.id) ?? {}, { messageDate: messageDateOf(row) });
      const { error: upErr } = await db
        .from("classnote_parent_messages")
        .update({
          classified_at: new Date().toISOString(),
          category: intent.category,
          starts_on: intent.startsOn,
          ends_on: intent.endsOn,
          detail: intent.detail,
          model,
          classify_error: null,
        })
        .eq("id", row.id);
      if (upErr) {
        out.failed++;
        continue;
      }
      out.classified++;
      if (isAttendanceIntent(intent)) out.attendance++;
    }
  }

  // 알림은 **분류와 분리된 스윕**으로 보낸다(아래 함수 주석 참조 — 중복·유실·벨폭탄을 한 번에 막는다).
  out.notified += await notifyPending(db, tenantId);
  return out;
}

/**
 * 출결로 분류됐는데 아직 안 알린 건을 훑어 알린다.
 *
 * 왜 분류 루프 안에서 바로 안 보내나 — 세 가지가 한꺼번에 해결되기 때문이다:
 *  ① **유실 창**: 루프 안에서 보내면 "분류는 저장됐는데 알림 직전에 죽는" 순간 그 건은 영영 안 간다
 *     (다음 킥은 이미 분류된 행을 안 본다). 스윕은 `notified_at is null`을 보므로 다음 킥이 이어받는다.
 *  ② **중복**: 킥이 겹칠 수 있다(워커가 글·댓글 폴에서 각각 킥하고, 앞 요청이 타임아웃돼도 서버는 계속 돈다).
 *     notifications엔 유니크 제약이 없어 중복이 그대로 벨에 쌓이므로, **조건부 update로 먼저 선점**한다.
 *  ③ **벨 폭탄**: 아래 age 가드 — 토글을 나중에 켜면 과거분이 통째로 쏟아지는 것을 막는다.
 */
async function notifyPending(db: ReturnType<typeof createAdminClient>, tenantId?: string): Promise<number> {
  const COLUMNS = "id, tenant_id, content, posted_at, created_at, student_id, category, starts_on, ends_on, detail, source, class_name";
  const pendingRows = (columns: string) => {
    const query = db
      .from("classnote_parent_messages")
      .select(columns)
      .not("classified_at", "is", null)
      .is("notified_at", null)
      .neq("category", "none")
      .order("created_at", { ascending: true })
      .limit(MAX_PER_RUN);
    return tenantId ? query.eq("tenant_id", tenantId) : query;
  };
  // 🔴 `cross_teacher_ids`(0331a)는 SQL을 손으로 적용하기 전에도 앱이 돈다(#95) — 그 칸이 없어서 실패한 것이면(42703) 그 칸 없이 다시 읽는다.
  //    여기서 그냥 실패하면 출결 알림 전체가 조용히 멈춘다. 다른 실패는 종전대로 이번 킥을 건너뛴다(다음 킥이 이어받는다).
  let res = await pendingRows(`${COLUMNS}, cross_teacher_ids`);
  if (res.error?.code === "42703" || res.error?.code === "PGRST204") res = await pendingRows(COLUMNS);
  const rows = (res.data ?? []) as unknown as NotifyRow[];
  if (!rows.length) return 0;

  const studentIds = [...new Set(rows.map((r) => r.student_id).filter((v): v is string => !!v))];
  const students = await fetchInChunks(studentIds, (chunk) => db.from("students").select("id, name").in("id", chunk));
  const nameOf = new Map((students ?? []).map((s) => [s.id as string, (s.name as string) ?? ""]));

  const cutoff = Date.now() - ALERT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let sent = 0;
  for (const row of rows) {
    const at = Date.parse(row.posted_at ?? row.created_at);
    // 오래된 건 — **소인만 하고 안 보낸다.** 안 찍으면 매 킥마다 다시 훑어 이 목록에 영원히 남는다.
    if (Number.isFinite(at) && at < cutoff) {
      await db.from("classnote_parent_messages").update({ notified_at: new Date().toISOString() }).eq("id", row.id);
      continue;
    }
    // 🔴 **선점(compare-and-set)** — 이 update가 행을 못 잡으면 다른 러너가 이미 알린 것이므로 보내지 않는다.
    const { data: claimed } = await db
      .from("classnote_parent_messages")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("notified_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const intent: ParentIntent = {
      category: row.category as ParentIntent["category"],
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      detail: row.detail,
      // 저장된 값에서 되살릴 땐 추정 여부를 알 수 없다 — **없는 표시를 지어내지 않는다**(제목이 조용히 달라질 뿐).
      dateAssumed: false,
    };
    const count = await notifyRecipients(db, row, intent, nameOf.get(row.student_id ?? "") ?? "");
    // 아무에게도 못 보냈으면(토글 켠 사람 0명·학생 미상) 선점을 **되돌린다** — 나중에 토글을 켜면
    // 그때 최근 건은 정상적으로 간다(오래된 건 위 age 가드가 걸러낸다).
    if (count === 0) {
      await db.from("classnote_parent_messages").update({ notified_at: null }).eq("id", row.id);
      continue;
    }
    sent += count;
  }
  return sent;
}

/**
 * 토글(`users.attendance_alert_optin`)을 켠 계정에 알림을 만든다.
 *
 * 원장 2026-08-06: *"직원설정에서 '학생 출결 알림 (클래스노트) 받기' 토글 켜놓으면 그 계정에 모든 알림
 * 가는걸로"* — **담당 반과 무관하게 전 학생**이다(셔틀 기사가 담임에게 묻지 않게 하는 게 목적).
 *
 * ⚠️ **같은 과목** 담당 강사 벨은 여기서 만들지 않는다 — 기존 인바운드 알림(`classnote_parent_post/comment`)이 이미
 *    담당 강사에게 원문을 보낸다. 여기서 또 넣으면 담임 벨에 같은 얘기가 두 번 쌓인다.
 *
 * **다른 과목 담당 선생님**(0331a, 원장 2026-10-02 김근호 건)은 여기서 함께 알린다 — 아버지가 영어 반 글에 단 "오늘 학원 쉽니다"를
 * 그날 수업을 하는 수학 선생님이 알 길이 없었다. 누구인지는 연동 PC가 원문 행에 적어 둔다(`cross_teacher_ids` — 그 학생의, 글이
 * 올라온 보드 과목이 아닌 과목의 지금 담당). 여기서는 **같은 지점·재직·학생 계정 아님**만 다시 확인하고 벨에 더한다.
 * 🔴 출결로 분류된 연락만 여기 온다(인사 댓글은 다른 과목 담당에게 가지 않는다). 휴대폰 푸시는 종전대로 토글 켠 계정만(0188a 결정).
 * ⚠️ `notified_at` 선점은 **호출부(notifyPending)**가 한다 — 여기서 또 찍으면 선점 규약이 두 군데로 갈린다.
 */
async function notifyRecipients(
  db: ReturnType<typeof createAdminClient>,
  row: NotifyRow,
  intent: ParentIntent,
  studentName: string,
): Promise<number> {
  if (row.student_id === null && !studentName) {
    // 누구 얘기인지 모르면 알리지 않는다 — 이름 없는 "결석" 알림은 셔틀에 아무 쓸모가 없고 오히려 혼선이다.
    return 0;
  }
  // ⚠️ admin client는 RLS를 우회한다 → tenant 필터 필수(다른 학원 직원에게 새면 대형 사고).
  const cross = crossTeacherIds(row.cross_teacher_ids);
  const [{ data: recipients }, { data: crossUsers }] = await Promise.all([
    db.from("users").select("id").eq("tenant_id", row.tenant_id).eq("status", "active").eq("attendance_alert_optin", true),
    cross.length
      ? db.from("users").select("id").eq("tenant_id", row.tenant_id).eq("status", "active").neq("system_role", "student").in("id", cross)
      : Promise.resolve({ data: [] as Array<{ id: string }> }),
  ]);
  const optedIn = (recipients ?? []).map((u) => u.id as string);
  const targets = mergeAlertTargets(optedIn, (crossUsers ?? []).map((u) => u.id as string));
  if (!targets.length) return 0;

  const { title, body } = buildAttendanceAlert({
    studentName: studentName || "학생",
    intent,
    content: row.content,
    // 원문 날짜("8월 11일")를 푸는 축 — 판정이 못 담은 날이 있으면 벨이 그 사실을 적는다.
    messageDate: messageDateOf(row),
    // 어느 반 보드의 글인지 댓글인지(원장 2026-11-04) — 작성자 칸은 없어 '학부모'라고 적지 않는다.
    source: row.source ?? null,
    className: row.class_name ?? null,
  });
  const link = row.student_id ? `/students/${row.student_id}` : null;
  const { error } = await db.from("notifications").insert(
    targets.map((recipientId) => ({
      tenant_id: row.tenant_id,
      recipient_id: recipientId,
      type: ATTENDANCE_ALERT_TYPE,
      title,
      body,
      link,
    })),
  );
  if (error) return 0;
  // 휴대폰(웹 푸시) — 셔틀은 사무실 PC 앞에 없다(0188a). 벨이 진실이고 이건 "빨리 알려주는 수단"이라
  // **best-effort**다: 키·구독·표가 없으면 조용히 0을 돌려주고 절대 throw하지 않는다.
  if (optedIn.length) await sendPushToUsers(row.tenant_id, optedIn, { title, body, link, tag: row.id });
  return targets.length;
}
