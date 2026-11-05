import "server-only";

/**
 * **영어 개별 공지·교재요청서의 반 방 경로** — 대상 반 확정의 조회부. 판정은 순수 [`pickEnglishNoticeClass`](../notice-class-pick.ts).
 *
 * 원장 2026-11-04 *"앞으로 1인보드에 배정 시키지마 절대"* 뒤로 `(영어)이름` 1인 보드가 없는 영어 신입은 개별 공지·교재요청서를
 * 받을 곳이 없었다 → *"추천으로 해"*: 영어도 보고서처럼 **반 방**으로 보낸다. 삼자 일치(보내는 선생님 – 반 – 학생)로 그 학생의 영어 반을
 * 정하고, 그 반에 ClassNote 반 방 연결(s2_0006 `classnote_english_class_boards` — 사람이 확인한 것만)이 있으면 반 방, 없으면 지금처럼
 * 이미 있는 1인 보드(새로 만들지 않는다).
 * 🔴 원아는 여기서 고르지 않는다 — 워커가 게시 직전에 원아 연결(0185a) ∩ 지금 그 방 원아로 고른다(영어 보고서와 같은 함수
 *    `resolveEnglishClassTargets` · 이름으로 찾지 않는다 · 방에 없으면 막는다).
 * ⚠️ admin 클라이언트 + tenant 필터(RLS 우회) — 수학 경로와 같은 이유(판정이 사람마다 달라지지 않게). 돌려주는 것은 반 이름·반 방 이름뿐.
 * ⚠️ 연결표가 없으면(s2_0006 전 DB) 연결 0으로 본다 = 지금처럼 1인 보드([[#95]]). 그 밖의 조회 실패는 throw — 호출부가 그 발송을 막는다
 *    (연결이 있는지 모르는 채 1인 보드로 보내면 반 방과 섞인다 — 워커의 보고서 경로와 같은 판단).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { pickEnglishNoticeClass, type EnglishNoticePick } from "../notice-class-pick";
import { attendingClassesOf, studentLegQuery, teacherLegQueries, teachersByClass } from "./notice-route-legs";
import type { NoticeClassRequest } from "./notice-class-route";

/** 반 방 경로를 타는 과목 키 — 워커 `ENGLISH_ROUTE_SUBJECTS`(english-class-route.mjs)와 같은 값. 큐 대상의 `subject` 표식도 이 값이다. */
export const ENGLISH_NOTICE_SUBJECT = "english" as const;

/** 반 방 연결표가 아직 없다(s2_0006 전) — PostgREST는 PGRST205, Postgres는 42P01. */
const isMissingTable = (e: { code?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205");

/**
 * 학생별 영어 공지의 갈 곳 — 반 방(`route: "room"` + 반) 또는 지금처럼 1인 보드(`route: "personal"`). 요청한 학생마다 하나씩 돌려준다.
 * 영어 반 후보 = 오늘 다니는 반 중 영어 · 활성 · 종강 전.
 * 🔴 보고서 미발송 반은 ClassNote 대상이 아니다(11-04) — 반 방이 이어져 있어도 **반 방으로는 보내지 않는다**(`room: null`). 후보에서
 *    지우지는 않는다: 사무실 '반 공지' 탭은 미발송 반도 고를 수 있어서, 지우면 고른 반이 사라져 그 학생의 **다른 반 반 방**으로 옮겨 간다
 *    ('고른 반의 일' 조항 위반 · 재리뷰 2026-11-04). 그 반으로 정해지면 지금처럼 1인 보드.
 */
export async function resolveEnglishNoticeClasses(
  tenantId: string,
  requests: readonly NoticeClassRequest[],
  date: string = kstToday(),
): Promise<Map<string, EnglishNoticePick>> {
  const out = new Map<string, EnglishNoticePick>();
  const studentIds = [...new Set(requests.map((r) => r.studentId).filter(Boolean))];
  if (!studentIds.length) return out;
  const admin = createAdminClient();

  // ① 학생 다리 — 오늘 다니는 반(수학 경로와 한 벌).
  const classesOf = attendingClassesOf(await studentLegQuery(admin, tenantId, studentIds), date);
  const classIds = [...new Set([...classesOf.values()].flatMap((s) => [...s]))];
  if (!classIds.length) {
    for (const r of requests) out.set(r.studentId, { route: "personal" });
    return out;
  }

  const teacherIds = [...new Set(requests.flatMap((r) => [...(r.teacherIds ?? [])]))];
  // 서로 독립인 조회 — 한 번에(B4). 반·연결은 반 id 청크(B3) — 연결표는 (지점, 반)이 기본 키라 청크당 100행을 넘지 않는다.
  const [classes, rooms, slots, delegations] = await Promise.all([
    fetchInChunks<{
      id: string; class_name: string; subject: string | null; is_active: boolean | null; report_optout: boolean | null;
      closed_at: string | null; teacher_id: string | null;
    }>(classIds, (chunk) =>
      admin
        .from("classes")
        .select("id, class_name, subject, is_active, report_optout, closed_at, teacher_id")
        .eq("tenant_id", tenantId)
        .in("id", chunk),
    ),
    fetchInChunks<{ class_id: string; board_name: string | null }>(classIds, async (chunk) => {
      const res = await admin.from("classnote_english_class_boards").select("class_id, board_name").eq("tenant_id", tenantId).in("class_id", chunk);
      return isMissingTable(res.error) ? { data: [], error: null } : res;
    }),
    ...teacherLegQueries(admin, tenantId, classIds, teacherIds, date),
  ]);

  // 영어 반 후보(활성 · 종강 전). 수학 반·다른 과목 반은 여기서 빠진다. 미발송 반은 후보로 남기되 반 방은 쓰지 않는다(아래 room).
  const english = new Map(
    classes
      .filter((c) => c.subject === ENGLISH_NOTICE_SUBJECT && c.is_active && (!c.closed_at || c.closed_at.slice(0, 10) >= date))
      .map((c) => [c.id, c]),
  );
  // 반 방 이름이 비어 있으면 반 이름으로 보인다(표시 키·로그용 — 워커는 연결표의 반 방 번호로 올린다).
  const roomOf = new Map(rooms.map((r) => [r.class_id, (r.board_name ?? "").trim()]));
  const teachersOf = teachersByClass({ classes: english.values(), slots, delegations, teacherIds, date });

  for (const r of requests) {
    const senders = [...(r.teacherIds ?? [])];
    const mine = [...(classesOf.get(r.studentId) ?? [])].filter((id) => english.has(id));
    out.set(
      r.studentId,
      pickEnglishNoticeClass({
        classes: mine.map((id) => {
          const c = english.get(id)!;
          return {
            classId: id,
            className: c.class_name,
            // 미발송 반은 반 방이 있어도 null — 그 반으로 정해지면 1인 보드(반 방 있는 다른 반으로 옮기지 않는다).
            room: roomOf.has(id) && !c.report_optout ? roomOf.get(id) || c.class_name : null,
            taught: senders.some((t) => teachersOf.get(id)?.has(t)),
            homeroom: !!c.teacher_id && senders.includes(c.teacher_id),
          };
        }),
        teacher: !senders.length ? "none" : r.teacherStrict ? "strict" : "prefer",
        hints: r.hints,
      }),
    );
  }
  return out;
}
