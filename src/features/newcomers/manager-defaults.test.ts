import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readMigration } from "@/lib/db/migrations-corpus.mjs";
import { ENGLISH_TRACK_LABEL } from "@/features/classes/english-track";
import { EIE_DEFAULT_SUBJECT, managerDefaultRows, managerDefaultSubjectLabel, managerDefaultSubjects, NEWCOMER_MANAGER_ROLES, type ManagerDefaultView } from "./manager-defaults";

/**
 * 신규생 과목 기본 담당 — 줄 규칙(2026-11-11 · Claude·Codex 합의안). 띠 · 대화상자 · 저장 액션이 같은 함수를 쓴다.
 * 합성 값만 쓴다.
 */
const labelOf = (key: string) => ({ math: "수학", english: "영어", science: "과학" })[key] ?? key;
const OPTIONS = [{ value: "math", label: "수학" }, { value: "english", label: "영어" }, { value: "science", label: "과학" }];
const heo = { id: "m-1", name: "허은진" }, jung = { id: "m-2", name: "정유진" };
const STAMP = "2026-11-10T16:46:59.510883+00:00";
const view = (subject: string, manager: ManagerDefaultView["manager"]): ManagerDefaultView => ({ subject, manager, updatedAt: STAMP });

describe("managerDefaultSubjects — 줄이 서는 과목", () => {
  it("지금 과목(학원 설정 차례) + 이미 줄이 있는 EiE", () => {
    expect(managerDefaultSubjects(["math", "english", "science"], ["eie", "english", "math"], true)).toEqual(["math", "english", "science", "eie"]);
  });
  it("🔴 EiE 줄은 새로 만들지 않는다 — 줄이 없거나 EiE 기능이 꺼진 지점에는 세우지 않는다", () => {
    expect(managerDefaultSubjects(["math", "english"], ["math"], true)).toEqual(["math", "english"]);
    expect(managerDefaultSubjects(["math", "english"], ["eie"], false)).toEqual(["math", "english"]);
  });
  it("🔴 과목 목록에서 지운 과목의 줄은 서지 않는다 — 같은 키의 과목을 다시 만들면 다시 선다", () => {
    expect(managerDefaultSubjects(["math"], ["math", "science", "subject_3"], true)).toEqual(["math"]);
    expect(managerDefaultSubjects(["math", "science"], ["math", "science", "subject_3"], true)).toEqual(["math", "science"]);
  });
  it("과목 목록에 같은 키가 있으면 그 과목 한 줄뿐이다(겹쳐 세우지 않는다)", () => {
    expect(managerDefaultSubjects(["math", "eie"], ["eie"], true)).toEqual(["math", "eie"]);
    expect(managerDefaultSubjects(["math", "math"], [], true)).toEqual(["math"]);
  });
});

describe("managerDefaultRows — 대화상자의 줄", () => {
  const rows = managerDefaultRows(OPTIONS, [view("math", heo), view("english", null), view(EIE_DEFAULT_SUBJECT, jung)], labelOf);

  it("지금 과목마다 한 줄 + EiE 줄 — 기본 담당이 없으면 '지정 없음'(updatedAt 없음 = 저장하면 새 줄)", () => {
    expect(rows.map((r) => [r.subject, r.label])).toEqual([["math", "수학"], ["english", "영어"], ["science", "과학"], ["eie", "EiE"]]);
    expect(rows[0]).toMatchObject({ manager: heo, assigned: true, updatedAt: STAMP });
    expect(rows[2]).toMatchObject({ manager: null, assigned: false, updatedAt: null });
  });
  it("지정했던 담당자가 지금은 담당할 수 없으면 줄은 있고 담당자는 비어 있다(재지정 필요)", () => {
    expect(rows[1]).toMatchObject({ manager: null, assigned: true, updatedAt: STAMP });
  });
  it("🔴 EiE 줄에는 지금 어느 학생에게도 적용되지 않는다는 사실을 적는다 — 과목 줄에는 붙지 않는다", () => {
    expect(rows[3]!.note).toContain("‘영어’ 기본 담당을 따릅니다");
    expect(rows[3]!.note).toContain("어느 학생에게도 적용되지 않습니다");
    for (const r of rows.slice(0, 3)) expect(r.note, r.subject).toBeUndefined();
  });
  it("기본 담당이 하나도 없는 학원 — 과목마다 '지정 없음' 한 줄", () => {
    expect(managerDefaultRows(OPTIONS, [], labelOf).map((r) => [r.subject, r.assigned])).toEqual([["math", false], ["english", false], ["science", false]]);
  });
});

describe("managerDefaultSubjectLabel — 과목 이름(영문 키를 화면에 내지 않는다)", () => {
  it("과목 목록의 이름 · EiE는 프로그램 이름", () => {
    expect(managerDefaultSubjectLabel("math", labelOf)).toBe("수학");
    expect(managerDefaultSubjectLabel("eie", labelOf)).toBe("EiE");
    // 과목 목록에 같은 키의 과목이 있으면 그 이름이 이긴다.
    expect(managerDefaultSubjectLabel("eie", (k) => (k === "eie" ? "이아이이 과정" : k))).toBe("이아이이 과정");
  });
});

describe("코드와 DB · 다른 화면이 같은 약속을 한다", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");

  it("🔴 기본 담당이 될 수 있는 역할 = DB 검증 트리거(s2_0062)와 같은 넷", () => {
    const sql = readMigration("s2_0062_newcomer_subject_managers.sql");
    const roles = /system_role in \(([^)]*)\)/.exec(sql)?.[1]?.split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(roles).toEqual([...NEWCOMER_MANAGER_ROLES]);
    // 화면의 후보 목록 · 학생별 배정도 같은 넷이다(둘 다 손으로 적혀 있다 — 한쪽만 바뀌면 여기서 걸린다).
    const list = `[${NEWCOMER_MANAGER_ROLES.map((r) => `"${r}"`).join(", ")}]`;
    expect(read("features", "newcomers", "server", "followup-query.ts")).toContain(`${list}.includes(p.system_role)`);
    expect(read("features", "newcomers", "server", "followup-actions.ts")).toContain(`.in("system_role", ${list})`);
  });

  it("🔴 EiE 줄의 안내가 사실이다 — 신규생 관리의 과목 축은 반의 과목뿐이다(영어 프로그램으로 가르지 않는다)", () => {
    const cohort = read("features", "newcomers", "server", "cohort.ts");
    expect(cohort).toMatch(/from\("classes"\)\.select\("id, subject"\)/);
    expect(cohort).not.toMatch(/english_track/);
    const query = read("features", "newcomers", "server", "followup-query.ts");
    expect(query).toMatch(/select\("id,subject,teacher_id,is_active,closed_at,is_makeup_pool"\)/);
    expect(query).not.toMatch(/english_track/);
  });

  it("띠 · 대화상자가 같은 이름 규칙을 쓴다 — 띠에 'eie'를 다시 적지 않는다", () => {
    const workspace = read("features", "newcomers", "followup-workspace.tsx");
    expect(workspace).toContain("managerDefaultSubjectLabel(d.subject,labelOf)");
    expect(workspace).not.toContain('"eie"');
    // 고치는 단추는 canManage일 때만 선다(서버 액션이 같은 판정을 다시 본다 — manager-defaults-actions.test.ts).
    expect(workspace).toMatch(/data\.canManage\?<ManagerDefaultsButton /);
  });
});

describe("s2_0066 — 기본 담당 표 전용 감사 트리거", () => {
  const sql = readMigration("s2_0066_newcomer_default_manager_audit.sql");
  const body = sql.replace(/--[^\n]*/g, "");

  it("🔴 기본 담당 표에 AFTER INSERT OR UPDATE로 걸고, 전용 함수가 audit_logs에 넣는다(학생 표용 이력 함수를 쓰지 않는다)", () => {
    expect(body).toMatch(/create trigger onboarding_default_manager_audit after insert or update on public\.student_onboarding_manager_defaults\s+for each row execute function public\.audit_onboarding_default_manager\(\)/);
    expect(body).toMatch(/insert into public\.audit_logs \(tenant_id, actor_id, actor_name, action, target_type, target_label, metadata\)/);
    expect(body).not.toContain("audit_onboarding_followup");
    expect(body).not.toContain("student_onboarding_followup_events");
  });
  it("실행자 = 저장한 직원 · 대상 = 과목 · 이전·새 담당자를 남기고, 담당자가 그대로면 남기지 않는다", () => {
    expect(body).toMatch(/new\.tenant_id,\s+new\.updated_by,/);
    expect(body).toMatch(/if new\.manager_id is not distinct from old\.manager_id then\s+return null;/);
    for (const key of ["'subject', new.subject", "'fromManagerId', v_old_id", "'toManagerId', new.manager_id", "'fromName', v_old_name", "'toName', v_new_name"]) expect(body).toContain(key);
    // 액션·대상 유형은 표식과 함께 적는다(감사로그 레지스트리 가드가 이 표식으로 읽는다).
    expect(sql).toMatch(/'newcomer_default_manager_update', -- audit-action/);
    expect(sql).toMatch(/'newcomer_default_manager', -- audit-target-type/);
  });
  it("🔴 대상 칸 = 그때의 과목 이름(없으면 과목 키) — 과목 키만 남기면 슬랙 알림에 키가 나가고 지운 과목은 이름을 되찾지 못한다", () => {
    // 학원 설정의 과목 목록에서 읽되, 목록이 배열일 때만(목록이 없거나 깨져 있어도 저장을 막지 않는다).
    expect(body).toMatch(/select ts\.data #> '\{operations,subjects\}' into v_subjects from public\.tenant_settings ts where ts\.tenant_id = new\.tenant_id;/);
    expect(body).toMatch(/if jsonb_typeof\(v_subjects\) = 'array' then\s+select nullif\(btrim\(s\.item ->> 'label'\), ''\) into v_label\s+from jsonb_array_elements\(v_subjects\) as s\(item\)\s+where s\.item ->> 'key' = new\.subject\s+limit 1;/);
    expect(body).toMatch(/coalesce\(v_label, new\.subject\),/);
    expect(body).toContain("'subjectLabel', v_label");
    // EiE 줄의 이름은 앱과 같은 글자 — 과목 목록에 그 키가 없을 때만 쓴다.
    expect(body).toMatch(new RegExp(`if v_label is null and new\\.subject = '${EIE_DEFAULT_SUBJECT}' then\\s+v_label := '${ENGLISH_TRACK_LABEL.eie}';`));
  });
  it("호출자 권한 · search_path 고정 · 화면 계정 실행권 없음", () => {
    expect(body).toMatch(/language plpgsql set search_path = '' as/);
    expect(body).not.toMatch(/security definer/i);
    expect(body).toMatch(/revoke all on function public\.audit_onboarding_default_manager\(\) from public, anon, authenticated;/);
    expect(body).toMatch(/grant execute on function public\.audit_onboarding_default_manager\(\) to service_role;/);
  });
  it("되돌리기 스크립트가 같은 트리거·함수를 지운다", () => {
    const revert = readFileSync(join(process.cwd(), "scripts", "_oneoff", "revert-s2_0066-newcomer-default-manager-audit.sql"), "utf8");
    expect(revert).toContain("drop trigger if exists onboarding_default_manager_audit on public.student_onboarding_manager_defaults;");
    expect(revert).toContain("drop function if exists public.audit_onboarding_default_manager();");
  });
});
