import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canViewStudentDetail } from "./read-scope";
import { fetchInChunks } from "@/lib/supabase/batch";
import { personName } from "@/features/enrollment/same-person";
import { isMergedStudent } from "../status/merged";
import { guardianPhoneKeys, planSiblingSave, resolveSiblingIds, siblingBasis, siblingPair, type SiblingBasis, type SiblingPerson } from "../siblings";

/**
 * 원생 형제 — 조회·저장(판정은 `../siblings.ts` 한 벌). 학생 상세 '프로필' 형제 줄 · 학생 수정 화면 형제 칸 · 저장이 지난다.
 * 원생은 세션 클라이언트(RLS — 볼 수 있는 원생만), 짝 표(0376a)는 서버 전용이라 관리 키 + 지점 조건으로 읽고 쓴다.
 * 🔴 짝 표가 아직 없으면(SQL 적용 전) 자동 판정만 쓰고 `ready=false` — 화면이 죽지 않는다([[#95]]).
 */
type Db = Awaited<ReturnType<typeof createClient>>;

export type SiblingRow = SiblingPerson & {
  school: string | null;
  grade: string | null;
  status: string;
  notes?: string | null;
  is_test?: boolean | null;
};

const COLS = "id, name, school, grade, status, notes, is_test, parent_name, parent_phone, parent2_phone";
/** 한 원생의 형제 후보 상한 — 학부모 휴대폰·이름으로 좁힌 뒤라 넘을 일이 없다. */
const CANDIDATE_CAP = 100;

const quoted = (v: string) => `"${v}"`;
const plain = (s: string) => s.replace(/["\\%_*,()]/g, "");
const missingTable = (msg: string) => /PGRST205|42P01|does not exist|Could not find the table/i.test(msg);

/** 자동 판정 — 같은 학원 원생 중 학부모 휴대폰·이름이 맞는 원생(시험용·중복 병합된 원생 제외). */
export async function findAutoSiblings(
  db: Db,
  tenantId: string,
  me: SiblingPerson,
): Promise<{ row: SiblingRow; basis: SiblingBasis }[]> {
  const ors: string[] = [];
  // 보호자 휴대폰(보호자1·보호자2 — s2_0022)마다 상대의 두 칸을 다 본다(끝 8자리 · 표기 무관). 판정은 아래 `siblingBasis`.
  for (const phone of guardianPhoneKeys(me)) {
    const like = quoted(`%${phone.slice(-8, -4)}%${phone.slice(-4)}%`);
    ors.push(`parent_phone.ilike.${like}`, `parent2_phone.ilike.${like}`);
  }
  const parent = plain(personName(me.parent_name));
  if (parent.length >= 2) ors.push(`parent_name.ilike.${quoted([...parent].join("%"))}`);
  if (ors.length === 0) return [];
  const { data, error } = await db
    .from("students")
    .select(COLS)
    .eq("tenant_id", tenantId)
    .neq("id", me.id)
    .or(ors.join(","))
    .order("name")
    .limit(CANDIDATE_CAP);
  if (error) throw error; // 조용히 삼키지 않는다(B3)
  return ((data ?? []) as SiblingRow[])
    .filter((r) => !r.is_test && !isMergedStudent(r.notes))
    .flatMap((row) => {
      const basis = siblingBasis(me, row);
      return basis ? [{ row, basis }] : [];
    });
}

/** 사람이 정한 짝(0376a) — 상대 원생 id → linked. 표가 없으면 `ready=false`. */
export async function loadSiblingLinks(tenantId: string, studentId: string): Promise<{ ready: boolean; links: Map<string, boolean> }> {
  const { data, error } = await createAdminClient()
    .from("student_siblings")
    .select("student_a, student_b, linked")
    .eq("tenant_id", tenantId)
    .or(`student_a.eq.${quoted(studentId)},student_b.eq.${quoted(studentId)}`);
  if (error) {
    if (missingTable(error.message)) return { ready: false, links: new Map() };
    throw error;
  }
  const links = new Map<string, boolean>();
  for (const r of data ?? []) links.set(r.student_a === studentId ? r.student_b : r.student_a, r.linked);
  return { ready: true, links };
}

/** id로 원생 몇 명 — 사람이 지정한 형제가 자동 판정 밖일 때 이름을 채운다(RLS 안에서만). */
async function studentsByIds(db: Db, tenantId: string, ids: string[]): Promise<SiblingRow[]> {
  return fetchInChunks<SiblingRow>(ids, (chunk) => db.from("students").select(COLS).eq("tenant_id", tenantId).in("id", chunk));
}

export type SiblingView = { id: string; name: string; school: string | null; grade: string | null; status: string; basis: SiblingBasis | "manual" };

/**
 * 한 원생의 형제 — 화면에 보일 것(`siblings`) · 확인 후보(학부모 이름만 같고 휴대폰이 다름, 아직 형제 아님) · 자동 판정 id.
 * 상세 '프로필'은 `siblings`만, 수정 화면은 셋 다 쓴다.
 */
export async function loadStudentSiblings(db: Db, tenantId: string, me: SiblingPerson) {
  const [auto, { ready, links }] = await Promise.all([findAutoSiblings(db, tenantId, me), loadSiblingLinks(tenantId, me.id)]);
  const matched = auto.filter((a) => a.basis !== "conflict");
  const ids = resolveSiblingIds(matched.map((a) => a.row.id), links);
  const known = new Map(auto.map((a) => [a.row.id, a]));
  const extra = await studentsByIds(db, tenantId, ids.filter((id) => !known.has(id)));
  const view = (row: SiblingRow, basis: SiblingView["basis"]): SiblingView => ({
    id: row.id, name: row.name ?? "", school: row.school, grade: row.grade, status: row.status, basis,
  });
  const siblings = ids.flatMap((id) => {
    const hit = known.get(id);
    if (hit) return [view(hit.row, links.get(id) ? "manual" : hit.basis)];
    const row = extra.find((r) => r.id === id);
    return row && !row.is_test && !isMergedStudent(row.notes) ? [view(row, "manual")] : [];
  });
  const chosen = new Set(siblings.map((s) => s.id));
  const review = auto.filter((a) => a.basis === "conflict" && !chosen.has(a.row.id) && links.get(a.row.id) !== false).map((a) => view(a.row, "conflict"));
  return { ready, siblings, review, autoIds: matched.map((a) => a.row.id) };
}

/** 상세·수정 화면이 부르는 입구 — 지금 로그인(지점 보기면 보는 지점)의 원생 하나. 로그인이 없으면 빈 값. */
export async function getStudentSiblings(student: {
  id: string; name: string; parentName: string | null; parentPhone: string | null; parent2Phone?: string | null;
}) {
  const none = { ready: false, siblings: [] as SiblingView[], review: [] as SiblingView[], autoIds: [] as string[] };
  const user = await getCurrentUser();
  if (!user) return none;
  try {
    const found = await loadStudentSiblings(await createClient(), user.tenantId, {
      id: student.id, name: student.name, parent_name: student.parentName, parent_phone: student.parentPhone,
      parent2_phone: student.parent2Phone ?? null,
    });
    // 🔴 원생 표 RLS는 지점 단위라 강사(담당 학생만 열람)에게도 담당 밖 형제가 읽힌다 — 상세를 열 수 있는 형제만 남긴다
    //    ("존재 여부 자체도 담당 밖 정보다" · 학생 상세와 같은 판정 `canViewStudentDetail`). 열람 범위 제한이 없으면 전부 통과.
    const visible = await Promise.all(found.siblings.map((s) => canViewStudentDetail(s.id)));
    return { ...found, siblings: found.siblings.filter((_, i) => visible[i]) };
  } catch (e) {
    // 형제 줄 하나 때문에 학생 상세·수정 화면이 죽지 않게 — 로그는 남기고 형제 칸만 비운다.
    console.error("[students/siblings] 형제 조회 실패", e instanceof Error ? e.message : e);
    return none;
  }
}

/**
 * 수정 화면 저장 — **화면에서 바꾼 것만** 쓴다(`planSiblingSave`). `final` = 저장할 때 남은 형제 · `initial` = 열 때 있던 형제 ·
 * `suggested` = 열 때 자동 판정이 형제라 한 원생. 받은 id는 같은 학원 원생인지 다시 확인한다(화면 값을 믿지 않는다 — 트리거도
 * 막는다). 바뀐 것(이름)을 돌려준다 — 감사로그용. 조회·쓰기 실패는 던진다(부르는 쪽이 학생 저장과 따로 다룬다).
 */
export async function saveStudentSiblings(
  db: Db,
  input: { tenantId: string; userId: string; studentId: string; final: string[]; initial: string[]; suggested: string[] },
): Promise<{ added: string[]; excluded: string[]; removed: string[] }> {
  const none = { added: [], excluded: [], removed: [] };
  const asked = [...new Set([...input.final, ...input.initial])].filter((id) => id && id !== input.studentId).slice(0, 200);
  const rows = await studentsByIds(db, input.tenantId, asked);
  const nameOf = new Map(rows.map((r) => [r.id, r.name ?? ""]));
  const real = (ids: string[]) => ids.filter((id) => nameOf.has(id) && id !== input.studentId);
  const plan = planSiblingSave(real(input.final), real(input.initial), input.suggested);
  if (plan.set.length === 0 && plan.remove.length === 0) return none;
  const admin = createAdminClient();
  if (plan.set.length > 0) {
    const now = new Date().toISOString();
    const { error } = await admin.from("student_siblings").upsert(
      plan.set.map(({ other, linked }) => {
        const [a, b] = siblingPair(input.studentId, other);
        return { tenant_id: input.tenantId, student_a: a, student_b: b, linked, updated_by: input.userId, updated_at: now };
      }),
      { onConflict: "student_a,student_b" },
    );
    if (error) throw error;
  }
  for (const other of plan.remove) {
    const [a, b] = siblingPair(input.studentId, other);
    const { error } = await admin.from("student_siblings").delete().eq("tenant_id", input.tenantId).eq("student_a", a).eq("student_b", b);
    if (error) throw error;
  }
  const names = (ids: string[]) => ids.map((id) => nameOf.get(id) ?? "");
  return {
    added: names(plan.set.filter((s) => s.linked).map((s) => s.other)),
    excluded: names(plan.set.filter((s) => !s.linked).map((s) => s.other)),
    removed: names(plan.remove),
  };
}
