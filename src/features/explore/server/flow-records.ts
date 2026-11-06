import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstDateOf, kstToday } from "@/lib/date-kst";
import { visibleConsultationSummary } from "@/features/consultations/internal-link";
import { memoCategoryLabel } from "@/features/students/detail/memo-category";
import type { FlowRecord } from "../flow-insight";
import { isFutureBasis, recordDay } from "../flow-recency";

/**
 * 원생 흐름 분석이 읽는 기록 — 상담 일지 · 타임라인(원생 상세 타임라인과 같은 출처 다섯) · 밤 배치 후보. 갱신([`flow-insights.ts`](./flow-insights.ts)
 * `refreshFlowInsight`)과 크론만 쓴다 — 세션 없는 밤 배치에서도 돌아 admin 클라이언트 + 지점 필터. 오늘 뒤(예정) 기록은 갱신이 거른다(`upToToday`).
 */
type Admin = ReturnType<typeof createAdminClient>;

const CATEGORY_LABEL: Record<string, string> = { general: "일반", academic: "학습/성적", emotional: "정서/심리", career: "진로", social: "교우관계", other: "기타" };
const AUDIENCE_LABEL: Record<string, string> = { parent: "학부모", student: "학생", both: "학부모+학생" };

/** 상담 기록 → 한 줄씩(오래된 것부터). 내부 링크 조각은 뗀다(`visibleConsultationSummary`). */
export async function loadConsultationRecords(admin: Admin, tenantId: string, studentId: string): Promise<FlowRecord[]> {
  const rows = await fetchAllPaged<{
    consulted_at: string; category: string | null; audience: string | null; summary: string; follow_up_action: string | null; follow_up_date: string | null; follow_up_done: boolean | null;
    counselor: { display_name?: string } | { display_name?: string }[] | null;
  }>((from, to) =>
    admin.from("student_consultations").select("consulted_at, category, audience, summary, follow_up_action, follow_up_date, follow_up_done, counselor:counselor_id ( display_name )")
      .eq("tenant_id", tenantId).eq("student_id", studentId).order("consulted_at", { ascending: true }).order("id").range(from, to),
  );
  return rows.map((r) => {
    const who = (Array.isArray(r.counselor) ? r.counselor[0] : r.counselor)?.display_name;
    const head = [r.category ? CATEGORY_LABEL[r.category] ?? r.category : null, r.audience ? AUDIENCE_LABEL[r.audience] ?? r.audience : null, who ? `상담자 ${who}` : null].filter(Boolean).join(" · ");
    const follow = r.follow_up_action ? ` / 후속 조치: ${r.follow_up_action}${r.follow_up_date ? `(${r.follow_up_date})` : ""}${r.follow_up_done ? " — 완료" : ""}` : "";
    return { at: r.consulted_at, text: `${head ? `(${head}) ` : ""}${visibleConsultationSummary(r.summary).replace(/\s+/g, " ").slice(0, 600)}${follow}` };
  });
}

/**
 * 타임라인 기록 → 한 줄씩(오래된 것부터). 원생 상세 타임라인과 같은 출처 다섯(수강 · 상담 · 메모 · 성적 · 재원 상태) —
 * 세션이 없는 밤 배치에서도 돌아야 해서 admin 클라이언트로 따로 읽는다(지점 필터 필수).
 */
export async function loadTimelineRecords(admin: Admin, tenantId: string, studentId: string, today: string): Promise<FlowRecord[]> {
  const [enrolls, consults, memos, grades, { data: student }] = await Promise.all([
    fetchAllPaged<{ start_date: string; end_date: string | null; is_transferred: boolean | null; class: { class_name?: string; subject?: string } | { class_name?: string; subject?: string }[] | null }>((from, to) =>
      admin.from("enrollments").select("start_date, end_date, is_transferred, class:class_id ( class_name, subject )").eq("tenant_id", tenantId).eq("student_id", studentId).order("start_date").range(from, to)),
    loadConsultationRecords(admin, tenantId, studentId),
    fetchAllPaged<{ created_at: string; category: string | null; content: string }>((from, to) =>
      admin.from("student_memos").select("created_at, category, content").eq("tenant_id", tenantId).eq("student_id", studentId).order("created_at").range(from, to)),
    fetchAllPaged<{ taken_on: string; exam_name: string | null; subject: string | null; score: number | null; max_score: number | null }>((from, to) =>
      admin.from("student_grades").select("taken_on, exam_name, subject, score, max_score").eq("tenant_id", tenantId).eq("student_id", studentId).order("taken_on").range(from, to)),
    admin.from("students").select("enrolled_at, withdrawn_at, status").eq("tenant_id", tenantId).eq("id", studentId).maybeSingle(),
  ]);
  const out: FlowRecord[] = [];
  for (const e of enrolls) {
    const c = Array.isArray(e.class) ? e.class[0] : e.class;
    const name = c?.class_name ?? "반";
    out.push({ at: e.start_date, text: `${name} 수강 시작` });
    if (e.end_date && e.end_date <= today) out.push({ at: e.end_date, text: `${name} ${e.is_transferred ? "반 이동으로 종료" : "수강 종료"}` });
  }
  for (const c of consults) out.push({ at: c.at, text: `상담: ${c.text.slice(0, 300)}` });
  for (const m of memos) out.push({ at: m.created_at, text: `특이사항(${memoCategoryLabel(m.category)}): ${m.content.replace(/\s+/g, " ").slice(0, 200)}` });
  for (const g of grades) out.push({ at: g.taken_on, text: `시험 ${g.exam_name ?? ""}${g.subject ? ` (${g.subject})` : ""}: ${g.score ?? "—"}${g.max_score != null ? `/${g.max_score}` : ""}` });
  // 재원 시작·퇴원 = KST 날짜(시각이면 `slice(0, 10)`은 UTC 날짜라 하루 어긋난다).
  const enrolledOn = student?.enrolled_at ? kstDateOf(student.enrolled_at) : null;
  const withdrawnOn = student?.withdrawn_at ? kstDateOf(student.withdrawn_at) : null;
  if (enrolledOn) out.push({ at: enrolledOn, text: "재원 시작" });
  if (withdrawnOn && withdrawnOn <= today) out.push({ at: withdrawnOn, text: "퇴원" });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * 밤 배치 후보 — 한 지점에서 **타임라인 분석이 없거나, 마지막 분석 뒤 새 기록이 생긴 재원생**(상한 `limit`). 학생마다 묻지 않고
 * 지점 단위로 네 출처의 최근 기록을 한 번씩 읽어 학생별 최신 시점을 만든다(B2 — 페이징 · 집계는 JS지만 지점당 수백 행).
 */
export async function timelineRefreshCandidates(tenantId: string, limit: number): Promise<string[]> {
  const admin = createAdminClient();
  const [students, rows] = await Promise.all([
    fetchAllPaged<{ id: string }>((from, to) => admin.from("students").select("id").eq("tenant_id", tenantId).eq("status", "enrolled").order("id").range(from, to)),
    fetchAllPaged<{ student_id: string; covered_through: string | null }>((from, to) =>
      admin.from("student_flow_insights").select("student_id, covered_through").eq("tenant_id", tenantId).eq("kind", "timeline").order("id").range(from, to)),
  ]);
  const today = kstToday();
  const covered = new Map(rows.map((r) => [r.student_id, r.covered_through ?? ""]));
  const enrolled = new Set(students.map((s) => s.id));
  const fresh = students.filter((s) => !covered.has(s.id)).map((s) => s.id);
  const changed = new Set<string>();
  // 반영 시점이 앞날로 적힌 옛 분석(예정 수강을 기록으로 셌던 때 · 11-06 전) = 그 사이 기록이 '이미 반영'으로 빠지므로 다시 분석.
  // 맨 뒤(남는 자리)에만 — 오늘까지 기록이 하나도 없는 학생은 갱신이 '기록 없음'으로 끝나 다음 밤에도 다시 뽑히므로 앞자리를 먹지 않게.
  const repair = [...covered].filter(([sid, through]) => enrolled.has(sid) && isFutureBasis(through || null, today)).map(([sid]) => sid);
  // 분석이 있는 학생은 마지막 반영 시점 뒤 기록이 있을 때만 — 가장 오래된 반영 시점 뒤의 기록만 읽는다.
  const floor = [...covered.values()].filter(Boolean).sort()[0] ?? null;
  if (floor) {
    const [c, m, g, e] = await Promise.all([
      fetchAllPaged<{ student_id: string; consulted_at: string }>((from, to) => admin.from("student_consultations").select("student_id, consulted_at").eq("tenant_id", tenantId).gt("consulted_at", floor).order("id").range(from, to)),
      fetchAllPaged<{ student_id: string; created_at: string }>((from, to) => admin.from("student_memos").select("student_id, created_at").eq("tenant_id", tenantId).gt("created_at", floor).order("id").range(from, to)),
      fetchAllPaged<{ student_id: string; taken_on: string }>((from, to) => admin.from("student_grades").select("student_id, taken_on").eq("tenant_id", tenantId).gt("taken_on", floor.slice(0, 10)).order("id").range(from, to)),
      fetchAllPaged<{ student_id: string; start_date: string; end_date: string | null }>((from, to) => admin.from("enrollments").select("student_id, start_date, end_date").eq("tenant_id", tenantId).or(`start_date.gt.${floor.slice(0, 10)},end_date.gt.${floor.slice(0, 10)}`).order("id").range(from, to)),
    ]);
    // 앞날의 기록(예정 수강 등)은 새 기록이 아니다 — 갱신도 오늘까지만 본다(refreshFlowInsight).
    const mark = (sid: string, at: string) => {
      const through = covered.get(sid);
      if (through !== undefined && enrolled.has(sid) && recordDay(at) <= today && at > through) changed.add(sid);
    };
    for (const r of c) mark(r.student_id, r.consulted_at);
    for (const r of m) mark(r.student_id, r.created_at);
    for (const r of g) mark(r.student_id, r.taken_on);
    for (const r of e) {
      mark(r.student_id, r.start_date);
      if (r.end_date) mark(r.student_id, r.end_date);
    }
  }
  return [...new Set([...changed, ...fresh, ...repair])].slice(0, limit);
}
