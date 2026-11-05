import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { viewAsTeacher } from "@/lib/auth/view-as";

/**
 * '다른 강사 뷰'(원장 A → 직원 X)의 수납·교재·지출·환불 **쓰기** 클라이언트 고르기(원장 2026-11-05 강사뷰 전수 · 적대 리뷰 반영).
 *
 * 🔴 **세션(실제 계정 A의 RLS)으로 먼저 쓰고, RLS에 막혔을 때만 관리 클라이언트로 같은 문장을 다시 쓴다.**
 *    DB 활동 기록(`log_activity()` — expenses·textbook_orders·academy_documents 등)과 환불 데스크 할 일 닫기(s2_0011)는
 *    행위자를 `auth.uid()`로 남긴다. 관리 클라이언트(service_role)로 쓰면 행위자가 **비어** "누가 바꿨나"가 사라진다.
 *    그래서 A의 세션이 통과하는 쓰기(예: 원장 A의 수납 쓰기)는 세션으로 남기고, 막힐 때만 내려간다.
 * 막힘 판정:
 *   · insert — `42501`(RLS 위반)만. 0행·표현 없음은 막힘이 아니다(이미 들어갔을 수 있다 → 다시 쓰면 두 번 들어간다).
 *   · update·delete — `42501`(WITH CHECK 위반) 또는 **에러 없는 0행**(USING이 걸러 조용히 0행). 그래서 문장은 `.select(...)`로 끝낸다.
 * 강사뷰가 아니면 세션 결과 그대로 — 관리 클라이언트로 내려가지 않는다(종전과 같다).
 * 부르는 쪽 책임: ① 앱 게이트(대상 X의 권한·담당·소유, DB 규칙과 같은 뜻)를 **먼저** 지났다 ② `run`이 만드는 문장에
 *   `tenant_id`·`id` 등 조건을 모두 담는다 — 두 클라이언트가 **같은 조건**으로 쓴다.
 */
export type TeacherViewDb = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

type DbError = { code?: string; message: string } | null;
type DbResult = { data?: unknown; error: DbError };

export type WriteKind = "insert" | "mutate";

/** RLS에 막힌 쓰기인가(위 판정). */
export function blockedByRls(kind: WriteKind, res: DbResult): boolean {
  if (res.error) return res.error.code === "42501";
  if (kind === "insert") return false;
  return res.data == null || (Array.isArray(res.data) && res.data.length === 0);
}

export async function writeSessionFirst<R extends DbResult>(
  kind: WriteKind,
  run: (db: TeacherViewDb) => PromiseLike<R>,
): Promise<R & { via: "session" | "admin" }> {
  const first = await run(await createClient());
  if (!blockedByRls(kind, first) || !(await viewAsTeacher())) return { ...first, via: "session" };
  return { ...(await run(createAdminClient())), via: "admin" };
}

/**
 * **읽기** 클라이언트 — 강사뷰면 관리 클라이언트(조회는 활동 기록을 남기지 않는다). A의 RLS로 읽으면 X에게 보이는 행이
 * A의 권한에 따라 빠진다. 강사뷰 조회는 부르는 쪽이 `tenant_id`를 명시하고, DB 열람 규칙을 X 기준으로 앱에서 다시 본다.
 */
export async function teacherViewReadDb(): Promise<{ db: TeacherViewDb; viaAdmin: boolean }> {
  return (await viewAsTeacher()) ? { db: createAdminClient(), viaAdmin: true } : { db: await createClient(), viaAdmin: false };
}
