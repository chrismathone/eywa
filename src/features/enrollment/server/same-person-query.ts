import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { personName, phoneKeyOf, samePersonOf, type PersonRow } from "../same-person";

type Db = Awaited<ReturnType<typeof createClient>>;
type Query = ReturnType<ReturnType<Db["from"]>["select"]>;

export type SamePersonConsultRow = PersonRow & {
  subject: string | null;
  outcome: string;
  consulted_at: string;
  consultation_date: string | null;
};

const COLS =
  "id, student_id, prospect_name, prospect_school, prospect_grade, parent_phone, subject, outcome, consulted_at, consultation_date";
/** 후보 상한 — 같은 이름 꼴·같은 연락처·같은 원생으로 좁힌 뒤라 한 학원에서 이를 넘을 일이 없다(넘으면 최근 것부터). */
const CANDIDATE_CAP = 500;

/** PostgREST `or=(…)` 값 — 큰따옴표로 감싸 쉼표·괄호를 값으로 둔다(넘기는 값은 이미 따옴표·역슬래시가 없는 것). */
const quoted = (v: string) => `"${v}"`;
/** 이름 글자 중 패턴·문법에 끼어드는 것(따옴표·역슬래시·LIKE 와일드카드 `% _ *`·쉼표·괄호)은 뺀다. */
const plainName = (n: string) => n.replace(/["\\%_*,()]/g, "");

/**
 * 이 상담(또는 아직 저장 안 한 새 상담)과 **같은 학생**의 다른 신규 콜&상담 — 판정은 `same-person.ts` 한 벌.
 * 후보 = 같은 원생 · 이름 꼴이 같은 것(띄어쓰기 무시 — 글자 사이 `%`) · 연락처 끝 8자리가 같은 것을 한 번에 받고, 같은 열쇠
 * 규칙으로 거른다. 열쇠가 없으면(이름도 원생 연결도 없으면) 묻지 않는다. 최신순.
 * `tenantId` = 관리 키로 부를 때의 격리(세션 클라이언트는 RLS가 막는다 — 그래도 넘기면 이중 방어).
 */
export async function findSamePersonConsultations(
  db: Db,
  self: PersonRow,
  opts: { tenantId?: string; limit?: number } = {},
): Promise<SamePersonConsultRow[]> {
  const ors: string[] = [];
  if (self.student_id) ors.push(`student_id.eq.${quoted(plainName(self.student_id))}`);
  const name = plainName(personName(self.prospect_name));
  // 이름 꼴 — 글자 사이에 `%`를 둬 띄어쓰기만 다른 표기("김 지우")도 후보로 받는다(정확한 판정은 아래 열쇠 규칙).
  if (name) ors.push(`prospect_name.ilike.${quoted([...name].join("%"))}`);
  const phone = phoneKeyOf(self.parent_phone);
  // 휴대폰 끝 8자리 — 하이픈·띄어쓰기 표기가 달라도 받는다("010-1234-5678" · "01012345678"). 옛 3-3-4 표기는 여기 안 걸리지만
  // ③ 열쇠는 이름이 같아야 하니 위 이름 조건으로 이미 받는다.
  if (name && phone) ors.push(`parent_phone.ilike.${quoted(`%${phone.slice(-8, -4)}%${phone.slice(-4)}%`)}`);
  if (ors.length === 0) return [];

  const fetch = async (apply: (q: Query) => Query) => {
    let q = apply(db.from("enrollment_consultations").select(COLS));
    if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);
    const { data, error } = await q.order("consulted_at", { ascending: false }).limit(CANDIDATE_CAP);
    if (error) throw error; // 조용히 삼키지 않는다(B3)
    return (data ?? []) as SamePersonConsultRow[];
  };
  let rows = await fetch((q) => q.or(ors.join(",")));
  let same = samePersonOf(self, rows);
  // 묶음이 원생 연결을 얻었으면 그 원생의 상담을 한 번 더 — 이름 표기가 다른("김지우A"·영문명) 같은 원생의 상담은 위 후보
  // 조건에 안 걸린다(원생 연결 상담까지 카드 'N건' 묶음과 맞춘다 — 그 상담에서 또 이어지는 것은 따라가지 않는다).
  // 묶음의 원생은 하나뿐이라 많아야 한 번.
  const linked = self.student_id ? null : same.find((r) => r.student_id)?.student_id;
  if (linked) {
    const known = new Set(rows.map((r) => r.id));
    const extra = (await fetch((q) => q.eq("student_id", linked))).filter((r) => !known.has(r.id));
    if (extra.length > 0) {
      rows = [...rows, ...extra].sort((a, b) => (a.consulted_at < b.consulted_at ? 1 : a.consulted_at > b.consulted_at ? -1 : 0));
      same = samePersonOf(self, rows);
    }
  }
  return opts.limit ? same.slice(0, opts.limit) : same;
}
