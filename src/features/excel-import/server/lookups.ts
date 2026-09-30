import "server-only";
import { fetchAllPaged } from "@/lib/supabase/batch";
import type { createClient } from "@/lib/supabase/server";
import { normalizeSchoolName } from "@/features/schools/school-name";
import type { RowReader } from "../rows";

/**
 * 여러 가져오기가 함께 쓰는 **이름 → id** 찾기(원생·직원·반). 사람이 적는 엑셀엔 id가 없다 — 이름으로 찾되,
 * 🔴 **둘 이상이면 고르지 않는다**(오류로 알리고 학교·학년·과목을 더 적게 한다). 동명이인을 조용히 합치면 되돌릴 수 없다([[#132]]).
 * 조회는 전건 페이징(B2 — 1000행 절단 금지), 테넌트는 RLS + 명시 필터 둘 다.
 */
type Db = Awaited<ReturnType<typeof createClient>>;
const squash = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, "");
const gradeKey = (g: string | null | undefined) => squash(g).replace(/학년$/, "");

export type StudentLite = { id: string; name: string; school: string | null; grade: string | null; status: string; student_code: string | null };

export class StudentIndex {
  constructor(readonly rows: StudentLite[]) {}
  static async load(db: Db, tenantId: string, opt: { includeWithdrawn?: boolean } = {}): Promise<StudentIndex> {
    const rows = await fetchAllPaged<StudentLite>((from, to) => {
      let q = db.from("students").select("id, name, school, grade, status, student_code").eq("tenant_id", tenantId);
      if (!opt.includeWithdrawn) q = q.neq("status", "withdrawn");
      return q.order("id").range(from, to);
    });
    return new StudentIndex(rows);
  }
  byCode(code: string | null): StudentLite | null {
    if (!code) return null;
    const c = squash(code);
    return this.rows.find((r) => r.student_code && squash(r.student_code) === c) ?? null;
  }
  /** 이름(+학교·학년이 적혔으면 그것까지)으로. 여럿이면 여럿 그대로(호출부가 오류로 알린다). */
  match(name: string, school: string | null, grade: string | null): StudentLite[] {
    const n = squash(name);
    let c = this.rows.filter((r) => squash(r.name) === n);
    if (school) {
      const s = normalizeSchoolName(school);
      c = c.filter((r) => normalizeSchoolName(r.school) === s);
    }
    if (grade) c = c.filter((r) => gradeKey(r.grade) === gradeKey(grade));
    // 🔴 여럿이면 **재원생을 골라 주지 않는다** — 퇴원한 김철수의 옛 청구서가 지금 다니는 김철수에게 붙는다(적대 리뷰 2026-09-29, [[#132]]).
    return c;
  }
  /**
   * 행의 원생 칸(원생번호 → 이름·학교·학년)을 풀어 id 하나로. 못 찾거나 여럿이면 **그 칸 위치로** 오류.
   * `keys` = 이 시트에서 쓰는 열 키 이름.
   */
  resolve<K extends string>(row: RowReader<K>, keys: { code?: K; name: K; school?: K; grade?: K }): StudentLite | null {
    const code = keys.code ? row.text(keys.code) : null;
    if (code) {
      const hit = this.byCode(code);
      if (hit) return hit;
    }
    const name = row.text(keys.name, { required: !code });
    if (!name) {
      if (code) row.fail(keys.code!, "이 원생번호의 원생이 없습니다");
      return null;
    }
    const school = keys.school ? row.text(keys.school) : null;
    const grade = keys.grade ? row.text(keys.grade) : null;
    const c = this.match(name, school, grade);
    if (c.length === 1) return c[0]!;
    if (c.length === 0) {
      row.fail(keys.name, `'${name}' 원생을 찾지 못했습니다${school || grade ? `(${[school, grade].filter(Boolean).join(" ")})` : ""} — 원생목록에 먼저 등록하거나 이름·학교·학년을 확인하세요`);
    } else {
      const who = c.slice(0, 4).map((r) => [r.name, r.school, r.grade].filter(Boolean).join(" ")).join(" / ");
      row.fail(keys.name, `같은 이름 원생이 ${c.length}명입니다(${who}) — ${school && grade ? "원생번호 칸을 채워" : "학교·학년 칸(그래도 같으면 원생번호)을 채워"} 한 명으로 좁혀 주세요`);
    }
    return null;
  }
}

export type StaffLite = {
  id: string; display_name: string | null; email: string | null; english_name: string | null; status: string | null; system_role: string;
  /** 담당 과목 키 — 상담 과목 자동 채움(consultationSubject)이 쓴다. */
  subjects: string[] | null;
};

export class StaffIndex {
  constructor(readonly rows: StaffLite[]) {}
  static async load(db: Db, tenantId: string): Promise<StaffIndex> {
    const rows = await fetchAllPaged<StaffLite>((from, to) =>
      db.from("users").select("id, display_name, email, english_name, status, system_role, subjects").eq("tenant_id", tenantId).order("id").range(from, to),
    );
    return new StaffIndex(rows);
  }
  /** 이름·영문이름·이메일 중 무엇으로 적어도. 재직 중 우선. */
  match(label: string): StaffLite[] {
    const t = squash(label);
    const c = this.rows.filter((r) => squash(r.display_name) === t || squash(r.english_name) === t || squash(r.email) === t);
    if (c.length > 1) {
      const live = c.filter((r) => r.status !== "resigned" && r.status !== "inactive");
      if (live.length >= 1) return live;
    }
    return c;
  }
  resolve<K extends string>(row: RowReader<K>, key: K, required = false): StaffLite | null {
    const label = row.text(key, { required });
    if (!label) return null;
    const c = this.match(label);
    if (c.length === 1) return c[0]!;
    row.fail(key, c.length === 0 ? `'${label}' 직원을 찾지 못했습니다 — 직원관리의 이름 그대로 적어 주세요` : `'${label}' 이름의 직원이 ${c.length}명입니다 — 로그인 이메일로 적어 주세요`);
    return null;
  }
}

export type ClassLite = {
  id: string; class_name: string; subject: string | null; is_active: boolean; is_special: boolean | null; teacher_id: string | null; classroom_id: string | null;
  notes: string | null; closed_at: string | null;
};

export class ClassIndex {
  constructor(readonly rows: ClassLite[]) {}
  static async load(db: Db, tenantId: string): Promise<ClassIndex> {
    const rows = await fetchAllPaged<ClassLite>((from, to) =>
      db.from("classes").select("id, class_name, subject, is_active, is_special, teacher_id, classroom_id, notes, closed_at").eq("tenant_id", tenantId).order("id").range(from, to),
    );
    return new ClassIndex(rows);
  }
  match(name: string, subject: string | null): ClassLite[] {
    const n = squash(name);
    let c = this.rows.filter((r) => squash(r.class_name) === n);
    if (subject) c = c.filter((r) => r.subject === subject);
    if (c.length > 1) {
      const live = c.filter((r) => r.is_active);
      if (live.length === 1) return live;
    }
    return c;
  }
  resolve<K extends string>(row: RowReader<K>, key: K, subject: string | null, required = true): ClassLite | null {
    const name = row.text(key, { required });
    if (!name) return null;
    const c = this.match(name, subject);
    if (c.length === 1) return c[0]!;
    row.fail(key, c.length === 0 ? `'${name}' 반을 찾지 못했습니다 — 수업목록의 반 이름 그대로 적어 주세요(같은 파일 '반' 시트에 적은 새 반도 됩니다)` : `'${name}' 반이 과목별로 ${c.length}개입니다 — 과목 칸을 채워 주세요`);
    return null;
  }
}
