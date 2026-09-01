import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { addDays } from "@/lib/date-kst";
import {
  TRANSFER_GAP_DAYS,
  lifecycleBadgesInRange,
  type EnrollSpan,
  type LifecycleBadge,
  type OtherSpan,
  type SpanRange,
} from "@/features/attendance/enrollment-span";
import { mathSpansOf } from "../lib/roster";

/**
 * 그 달에 **경계가 있는 학생**(들어왔거나 나갔다)에게 신입·퇴원·반이동 표식을 붙인다.
 *
 * 판정은 출석부와 **같은 순수 함수**([enrollment-span.ts](@/features/attendance/enrollment-span))다 —
 * 원장 2026-09-01 *"출석부랑 비슷하게"*. IO만 여기 따로 두는 이유는 출석부는 세션 클라이언트(RLS)로
 * 읽고 MCS는 admin + `tenant_id` 명시 필터로 읽기 때문이다([[#104]]).
 *
 * 🔴 **경계가 있는 학생이 있을 때만** 다른 반을 조회한다(없으면 추가 쿼리 0).
 *    ⚠️ "평범한 달엔 0"은 **사실이 아니다** — 실측 2026-08: 반-달 68개 중 **43개(63%)**에 신입·퇴원
 *    경계가 있어 두 왕복이 세 번 중 두 번은 돈다. 작고 인덱스를 타는 조회라 감수하는 것이지 공짜가
 *    아니다. 여기에 조회를 더 얹을 땐 그 63%를 기준으로 볼 것.
 * 🔴 **임베드(`classes(...)`)를 쓰지 않는다** — enrollments→classes FK가 하나 늘어나는 순간
 *    손도 안 댄 이 화면이 PGRST201로 죽는다([[#94]]). 두 번 나눠 받고 코드에서 잇는다.
 * ⚠️ 다른 반 구간도 **같은 규약**(`mathSpansOf`)으로 편다 — 한쪽만 전출 하루 당김을 적용하면
 *    반이동의 두 짝(전출·전입)이 서로를 못 찾는다.
 */
export async function mathLifecycleBadges(args: {
  admin: ReturnType<typeof createAdminClient>;
  tenantId: string;
  classId: string;
  /** 표가 그리는 기간(그 달 1일~말일). */
  range: SpanRange;
  /** 학생 → 이 반 수강 구간(`mathSpansOf` 결과). */
  spansByStudent: ReadonlyMap<string, EnrollSpan[]>;
  /** 학생 → `students.withdrawn_at`(없으면 null). 다른 반 구간에도 같은 값을 먹인다. */
  withdrawnByStudent: ReadonlyMap<string, string | null>;
}): Promise<Map<string, LifecycleBadge[]>> {
  const { admin, tenantId, classId, range, spansByStudent, withdrawnByStudent } = args;
  const out = new Map<string, LifecycleBadge[]>();

  // 1차 판정(다른 반 모름) — 여기서 아무것도 안 나오면 추가 조회 자체를 안 한다.
  for (const [sid, spans] of spansByStudent) {
    const badges = lifecycleBadgesInRange(range, spans, "math");
    if (badges.length > 0) out.set(sid, badges);
  }
  if (out.size === 0) return out;

  const ids = [...out.keys()];
  const dates = [...out.values()].flat().map((b) => b.date).sort();
  const from = addDays(dates[0]!, -TRANSFER_GAP_DAYS);
  const to = addDays(dates[dates.length - 1]!, TRANSFER_GAP_DAYS);

  try {
    const rows = await fetchInChunks<{
      student_id: string;
      class_id: string;
      start_date: string | null;
      end_date: string | null;
      is_transferred: boolean | null;
    }>(ids, (chunk) =>
      admin
        .from("enrollments")
        .select("student_id, class_id, start_date, end_date, is_transferred")
        .eq("tenant_id", tenantId)
        .neq("class_id", classId)
        .in("student_id", chunk)
        .lte("start_date", to)
        .or(`end_date.is.null,end_date.gte.${from}`),
    );
    const otherClassIds = [...new Set(rows.map((r) => String(r.class_id)))];
    // 반이동은 **같은 과목**일 때만이라(transferTo) 수학 반만 이름이 필요하지만, 과목 판정 자체를
    // 그 순수 함수에 맡기려면 조회한 반의 과목을 그대로 넘겨야 한다.
    const metaRows = otherClassIds.length
      ? await fetchInChunks<{ id: string; class_name: string; subject: string | null }>(
          otherClassIds,
          (chunk) =>
            admin
              .from("classes")
              .select("id, class_name, subject")
              .eq("tenant_id", tenantId)
              .in("id", chunk),
        )
      : [];
    const meta = new Map(
      metaRows.map((c) => [
        String(c.id),
        { name: String(c.class_name), subject: c.subject ? String(c.subject) : null },
      ]),
    );

    const othersById = new Map<string, OtherSpan[]>();
    for (const r of rows) {
      const m = meta.get(String(r.class_id));
      if (!m) continue;
      const sid = String(r.student_id);
      const spans = mathSpansOf(
        [
          {
            startDate: r.start_date ? String(r.start_date).slice(0, 10) : null,
            endDate: r.end_date ? String(r.end_date).slice(0, 10) : null,
            isTransferred: r.is_transferred === true,
          },
        ],
        withdrawnByStudent.get(sid) ?? null,
      );
      if (spans.length === 0) continue;
      const list = othersById.get(sid) ?? [];
      list.push({
        classId: String(r.class_id),
        className: m.name,
        subject: m.subject,
        start: spans[0]!.start,
        end: spans[0]!.end,
      });
      othersById.set(sid, list);
    }

    for (const sid of ids) {
      out.set(
        sid,
        lifecycleBadgesInRange(range, spansByStudent.get(sid) ?? [], "math", othersById.get(sid) ?? []),
      );
    }
  } catch {
    // 🔴 보조 조회가 죽어도 1차 표식(신입·퇴원)은 살아 있어야 한다 — 다만 반이동이 '퇴원'으로 보일 수
    //    있다는 뜻이라, 조용히 빈 배열로 지우지는 않는다(없는 것보다 덜 정확한 편이 낫다).
  }
  return out;
}
