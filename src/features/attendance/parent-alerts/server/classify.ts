import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateJSON } from "@/lib/ai/generate";
import { kstToday } from "@/lib/date-kst";
import { fetchInChunks } from "@/lib/supabase/batch";
import {
  ATTENDANCE_ALERT_TYPE,
  buildAttendanceAlert,
  buildClassifyPrompt,
  isAttendanceIntent,
  normalizeIntent,
  type ParentIntent,
} from "../intent";

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

type ModelResult = { results?: Array<Record<string, unknown>> };

export type ClassifyOutcome = { scanned: number; classified: number; attendance: number; notified: number; failed: number };

/** 연락일(KST) — 상대 표현("오늘")을 푸는 축이라 반드시 KST로 잡는다. */
function messageDateOf(row: PendingRow): string {
  return kstToday(new Date(row.posted_at ?? row.created_at));
}

export async function classifyPendingParentMessages(): Promise<ClassifyOutcome> {
  const db = createAdminClient();
  const out: ClassifyOutcome = { scanned: 0, classified: 0, attendance: 0, notified: 0, failed: 0 };

  const { data: pending, error } = await db
    .from("classnote_parent_messages")
    .select("id, tenant_id, content, posted_at, created_at, student_id")
    .is("classified_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);
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

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    let parsed: ModelResult | null = null;
    let model = "";
    try {
      const res = await generateJSON<ModelResult>({
        provider: "deepseek", // 전사·상담 계열과 같은 선택 — 한국어 맥락 판단이 저렴하고 정확했다
        maxTokens: 4096,
        meta: { feature: "parent_attendance_intent", tenantId: batch[0]?.tenant_id },
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
  out.notified += await notifyPending(db);
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
async function notifyPending(db: ReturnType<typeof createAdminClient>): Promise<number> {
  const { data: pending } = await db
    .from("classnote_parent_messages")
    .select("id, tenant_id, content, posted_at, created_at, student_id, category, starts_on, ends_on, detail")
    .not("classified_at", "is", null)
    .is("notified_at", null)
    .neq("category", "none")
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);
  const rows = (pending ?? []) as Array<PendingRow & { category: string; starts_on: string | null; ends_on: string | null; detail: string | null }>;
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
    const count = await notifyOptedIn(db, row, intent, nameOf.get(row.student_id ?? "") ?? "");
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
 * ⚠️ 담당 강사 벨은 여기서 만들지 않는다 — 기존 인바운드 알림(`classnote_parent_post/comment`)이 이미
 *    담당 강사에게 원문을 보낸다. 여기서 또 넣으면 담임 벨에 같은 얘기가 두 번 쌓인다.
 * ⚠️ `notified_at` 선점은 **호출부(notifyPending)**가 한다 — 여기서 또 찍으면 선점 규약이 두 군데로 갈린다.
 */
async function notifyOptedIn(
  db: ReturnType<typeof createAdminClient>,
  row: PendingRow,
  intent: ParentIntent,
  studentName: string,
): Promise<number> {
  if (row.student_id === null && !studentName) {
    // 누구 얘기인지 모르면 알리지 않는다 — 이름 없는 "결석" 알림은 셔틀에 아무 쓸모가 없고 오히려 혼선이다.
    return 0;
  }
  // ⚠️ admin client는 RLS를 우회한다 → tenant 필터 필수(다른 학원 직원에게 새면 대형 사고).
  const { data: recipients } = await db
    .from("users")
    .select("id")
    .eq("tenant_id", row.tenant_id)
    .eq("status", "active")
    .eq("attendance_alert_optin", true);
  const targets = (recipients ?? []).map((u) => u.id as string);
  if (!targets.length) return 0;

  const { title, body } = buildAttendanceAlert({ studentName: studentName || "학생", intent, content: row.content });
  const { error } = await db.from("notifications").insert(
    targets.map((recipientId) => ({
      tenant_id: row.tenant_id,
      recipient_id: recipientId,
      type: ATTENDANCE_ALERT_TYPE,
      title,
      body,
      link: row.student_id ? `/students/${row.student_id}` : null,
    })),
  );
  if (error) return 0;
  return targets.length;
}
