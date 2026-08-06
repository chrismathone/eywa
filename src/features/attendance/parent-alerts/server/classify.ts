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
      if (!isAttendanceIntent(intent)) continue;
      out.attendance++;
      out.notified += await notifyOptedIn(db, row, intent, nameOf.get(row.student_id ?? "") ?? "");
    }
  }
  return out;
}

/**
 * 토글(`users.attendance_alert_optin`)을 켠 계정에 알림을 만든다.
 *
 * 원장 2026-08-06: *"직원설정에서 '학생 출결 알림 (클래스노트) 받기' 토글 켜놓으면 그 계정에 모든 알림
 * 가는걸로"* — **담당 반과 무관하게 전 학생**이다(셔틀 기사가 담임에게 묻지 않게 하는 게 목적).
 *
 * ⚠️ 담당 강사 벨은 여기서 만들지 않는다 — 기존 인바운드 알림(`classnote_parent_post/comment`)이 이미
 *    담당 강사에게 원문을 보낸다. 여기서 또 넣으면 담임 벨에 같은 얘기가 두 번 쌓인다.
 * ⚠️ `notified_at`으로 재발송을 막는다 — notifications엔 유니크 제약이 없어 중복이 그대로 벨에 쌓인다.
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
  await db.from("classnote_parent_messages").update({ notified_at: new Date().toISOString() }).eq("id", row.id);
  return targets.length;
}
