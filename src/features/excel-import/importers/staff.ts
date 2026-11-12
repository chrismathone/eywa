import "server-only";
import type { SystemRole } from "@/lib/permissions";
import { assignableRoles, canManageStaffMember, ROLE_HIERARCHY, ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { getSuperAdminIds } from "@/lib/auth/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { EMAIL_TAKEN_MESSAGE, isEmailTakenAuthError } from "@/lib/auth/auth-email-error";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { EMAIL_RE } from "@/features/staff/email";
import { subjectsFromDepartment } from "@/features/staff/department/department-subjects";
import { EMPLOYMENT_TYPES } from "@/features/staff/resume/resume";
import { isLoginEmailTakenElsewhere } from "@/features/staff/server/login-email-taken";
import { getViewerStaffScope } from "@/features/staff/department/server/subject-scope";
import { isStaffInSubjectScope } from "@/features/staff/department/subject-scope";
import { IMPORT_META } from "../kinds";
import { duplicateKeyIssues, type ColumnSpec, type ImportPreviewRow, type SheetSpec } from "../spec";
import type { ImporterDef } from "../server/types";
import { phoneLabel } from "@/lib/format/phone";

/**
 * 직원 가져오기 — 체크리스트 3번 "직원·계정". 새 직원은 **로그인 계정까지** 만든다(createStaff와 같은 순서:
 * auth `createUser`(app_metadata에 tenant_id·system_role) → 미러 트리거가 만든 users 최소 행을 **UPDATE**로 보강 → 실패 시 양쪽 롤백).
 *
 * 🔑 매칭 = 로그인 이메일(대소문자 무시). 다른 지점이 쓰는 이메일은 계정을 못 만든다(로그인 아이디는 전 지점에서 하나).
 * 🔑 역할은 **본인보다 엄격히 아래**만(`ROLE_HIERARCHY` — createStaff와 같은 선). 원장·학생은 만들 수 없다.
 * 🔴 급여(시급·기본급)·주민번호·계좌는 **열이 없다**(민감 필드 — 엑셀로 옮기지 않는다).
 * 🔴 덮어쓰기에서 **이름·이메일·역할·재직 상태는 안 바꾼다** — 이름·연락처·직급·입사일·부서·근무형태는 **이력서가 단일 소스**
 *    (docs/decisions/staff.md 2026-08-25)라 비어 있을 때만 채우고, 역할·이메일은 계정 관리, 퇴사는 인수인계가 함께 도는
 *    화면에서만. 덮어쓰기로 바꾸는 칸은 근무 설정 칸(담당 과목·영어 닉네임·메모)뿐이다.
 * 🔴 권한 밖 직원(자기보다 위 · 과목 범위 밖 · 숨은 총괄)은 건너뛴다([[#77]] — 계정 관리 게이트와 같은 선).
 * 🔑 새 계정 비밀번호 = 무작위(엑셀에 비밀번호를 적지 않는다). 직원 상세 › 계정 관리 › '비밀번호 재설정'으로 발급해 전달한다.
 */
type K = "email" | "name" | "role" | "phone" | "jobTitle" | "department" | "employmentType" | "subjects" | "hireDate" | "englishName" | "memo";

const SHEET = "직원";
const ROLE_OPTIONS = (Object.keys(ROLE_HIERARCHY) as SystemRole[])
  .filter((r) => r !== "student")
  .map((r) => ({ label: ROLE_LABEL[r], value: r }));

function columns(opt: { roles: readonly string[]; jobTitles: readonly string[]; subjects: readonly string[] }): ColumnSpec<K>[] {
  return [
    { key: "email", header: "이메일", width: 26, required: true, aliases: ["로그인이메일", "업무용이메일", "e-mail", "아이디"], hint: "로그인 아이디. 같은 직원을 찾는 기준입니다." },
    { key: "name", header: "이름", width: 10, required: true, aliases: ["성명", "직원명"] },
    { key: "role", header: "역할", width: 9, options: opt.roles, strictOptions: true, hint: "새 직원은 필수. 본인보다 아래 역할만 줄 수 있습니다. 기존 직원의 역할은 바꾸지 않습니다(계정 관리에서)." },
    { key: "phone", header: "연락처", width: 14, aliases: ["전화", "휴대폰"] },
    { key: "jobTitle", header: "직급", width: 9, options: opt.jobTitles },
    { key: "department", header: "근무부서", width: 12, aliases: ["부서"], hint: "담당 과목을 비우면 부서 이름에서 과목을 찾아 채웁니다(예: 수학과 → 수학)." },
    { key: "employmentType", header: "근무형태", width: 10, aliases: ["고용형태"], options: EMPLOYMENT_TYPES, strictOptions: true },
    { key: "subjects", header: "담당과목", width: 16, aliases: ["담당 과목", "과목"], hint: `여러 과목은 쉼표로(예: 수학, 영어). 학원 설정의 과목 이름: ${opt.subjects.join(" · ")}` },
    { key: "hireDate", header: "입사일", width: 12 },
    { key: "englishName", header: "영어 닉네임", width: 12, aliases: ["닉네임"], hint: "영어 시간표에 적는 이름(영문 성명과 다름)." },
    { key: "memo", header: "메모", width: 28, aliases: ["비고"] },
  ];
}
function spec(opt: Parameters<typeof columns>[0]): SheetSpec<K> {
  return { name: SHEET, columns: columns(opt), keyHint: IMPORT_META.staff.keyHint };
}

type Existing = {
  id: string; email: string | null; display_name: string | null; system_role: SystemRole; status: string | null; phone: string | null;
  job_title: string | null; department: string | null; employment_type: string | null; subjects: string[] | null; hire_date: string | null;
  english_name: string | null; memo: string | null;
};
const SELECT = "id, email, display_name, system_role, status, phone, job_title, department, employment_type, subjects, hire_date, english_name, memo";

type Profile = {
  phone: string | null; job_title: string | null; department: string | null; employment_type: string | null; hire_date: string | null;
  subjects: string[]; english_name: string | null; memo: string | null;
};
type Insert = { rowNum: number; email: string; name: string; role: SystemRole; profile: Profile };
type Update = { id: string; label: string; patch: Record<string, unknown> };
type Plan = { inserts: Insert[]; updates: Update[] };

/** 이력서가 단일 소스인 칸 — 덮어쓰기는 비어 있을 때만 채운다. */
const RESUME_OWNED = ["phone", "job_title", "department", "employment_type", "hire_date"] as const;
const RESUME_LABEL: Record<(typeof RESUME_OWNED)[number], string> = { phone: "연락처", job_title: "직급", department: "근무부서", employment_type: "근무형태", hire_date: "입사일" };

function randomPassword(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(14)))
    .map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31])
    .join("");
}

async function loadStaff(tenantId: string): Promise<Existing[]> {
  const admin = createAdminClient();
  // admin(RLS 우회) — tenant_id 필터가 격리의 전부다.
  return fetchAllPaged<Existing>((from, to) =>
    admin.from("users").select(SELECT).eq("tenant_id", tenantId).neq("system_role", "student").order("id").range(from, to),
  );
}

const def: ImporterDef<Plan> = {
  kind: "staff",
  title: IMPORT_META.staff.title,
  menu: "staff",
  sheets: [spec({ roles: [], jobTitles: [], subjects: [] })],
  singleSheet: true,
  modeHelp: IMPORT_META.staff.modeHelp,
  guide: [
    "· 한 줄 = 직원 한 명. 열 순서는 바꿔도 됩니다(제목으로 찾습니다). 주황 칸(*)은 필수입니다.",
    "· 같은 직원 판단 = 로그인 이메일. 새 이메일이면 로그인 계정을 만듭니다(다른 지점이 쓰는 이메일은 쓸 수 없습니다).",
    "· 새 계정 비밀번호는 엑셀에 적지 않습니다 — 올린 뒤 직원 상세 › 계정 관리 › '비밀번호 재설정'으로 발급해 전달하세요.",
    "· '덮어쓰기'는 담당과목·영어 닉네임·메모만 바꿉니다. 연락처·직급·입사일·근무부서·근무형태는 이력서가 기준이라 비어 있을 때만 채웁니다.",
    "· 이름·이메일·역할·퇴사는 엑셀로 바꾸지 않습니다(이력서·계정 관리·퇴사 처리 화면에서).",
    "· 급여(시급·기본급)·주민등록번호·계좌번호는 적지 마세요 — 이 파일로 옮기지 않습니다.",
  ],
  revalidate: ["/staff"],

  async template(ctx) {
    const [settings, rows, superIds, scope] = await Promise.all([
      getTenantSettings(),
      loadStaff(ctx.tenantId),
      getSuperAdminIds(),
      getViewerStaffScope(ctx.user),
    ]);
    const maps = buildSubjectMaps(settings.operations.subjects);
    const visible = rows.filter(
      (u) => !superIds.has(u.id) && (!scope || u.id === ctx.user.id || isStaffInSubjectScope(scope, u.subjects ?? [])),
    );
    visible.sort((a, b) => ROLE_HIERARCHY[a.system_role] - ROLE_HIERARCHY[b.system_role] || (a.display_name ?? "").localeCompare(b.display_name ?? "", "ko"));
    return [
      {
        spec: spec({
          roles: assignableRoles(ctx.user.systemRole).map((r) => ROLE_LABEL[r]),
          jobTitles: settings.operations.jobTitles,
          subjects: maps.options.map((o) => o.label),
        }),
        rows: visible.map((u) => ({
          email: u.email ?? "", name: u.display_name ?? "", role: ROLE_LABEL[u.system_role] ?? "", phone: phoneLabel(u.phone) ?? "",
          jobTitle: u.job_title ?? "", department: u.department ?? "", employmentType: u.employment_type ?? "",
          subjects: (u.subjects ?? []).map((k) => maps.labelOf(k)).join(", "), hireDate: u.hire_date?.slice(0, 10) ?? "",
          englishName: u.english_name ?? "", memo: u.memo ?? "",
        })),
      },
    ];
  },

  async plan({ ctx, mode, sheets, issues }) {
    const sheet = sheets[SHEET];
    const [settings, existing, superIds, scope] = await Promise.all([
      getTenantSettings(),
      loadStaff(ctx.tenantId),
      getSuperAdminIds(),
      getViewerStaffScope(ctx.user),
    ]);
    const maps = buildSubjectMaps(settings.operations.subjects);
    const subjectTable = maps.options.map((o) => ({ label: o.label, value: o.value }));
    const byEmail = new Map(existing.filter((u) => u.email).map((u) => [u.email!.trim().toLowerCase(), u]));
    const actorRank = ROLE_HIERARCHY[ctx.user.systemRole];
    const admin = createAdminClient();

    const plan: Plan = { inserts: [], updates: [] };
    const preview: ImportPreviewRow[] = [];
    const notes: string[] = [];
    const parsed: { rowNum: number; key: string }[] = [];
    const rows = sheet?.rows ?? [];
    const pending: { row: (typeof rows)[number]; insert: Insert; summary: string }[] = [];
    let skip = 0;

    for (const row of rows) {
      const emailRaw = row.text("email", { required: true, max: 120 });
      const email = emailRaw?.toLowerCase() ?? null;
      if (email && !EMAIL_RE.test(email)) row.fail("email", "이메일 모양이 아닙니다(예: kim@academy.com)");
      const name = row.text("name", { required: true, max: 40 });
      const role = row.option("role", ROLE_OPTIONS);
      const phone = row.phone("phone");
      const jobTitle = row.text("jobTitle", { max: 24 });
      const department = row.text("department", { max: 40 });
      const employmentType = row.option("employmentType", EMPLOYMENT_TYPES.map((t) => ({ label: t, value: t })));
      const hireDate = row.date("hireDate");
      const englishName = row.text("englishName", { max: 40 });
      const memo = row.text("memo", { max: 2000 });
      const subjects: string[] = [];
      for (const label of row.raw("subjects").split(/[,/·;\n]+/).map((s) => s.trim()).filter(Boolean)) {
        const hit = subjectTable.find((o) => o.label.replace(/\s+/g, "") === label.replace(/\s+/g, "") || o.value === label);
        if (!hit) {
          row.fail("subjects", `'${label}'은(는) 학원 설정에 없는 과목입니다 — ${subjectTable.map((o) => o.label).join(" · ")} 중에서`);
          continue;
        }
        if (!subjects.includes(hit.value)) subjects.push(hit.value);
      }
      if (!row.ok || !email || !name) continue;
      parsed.push({ rowNum: row.rowNum, key: email });

      const cur = byEmail.get(email);
      if (cur) {
        if (mode === "append") {
          skip += 1;
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: name, action: "skip", summary: `이미 있음 · ${email}` });
          continue;
        }
        // 권한 밖 — 숨은 총괄 · 자기보다 위 · 과목 범위 밖(계정 관리와 같은 선).
        const outOfScope = !!scope && cur.id !== ctx.user.id && !isStaffInSubjectScope(scope, cur.subjects ?? []);
        if (superIds.has(cur.id) || !canManageStaffMember(ctx.user.systemRole, cur.system_role) || outOfScope) {
          skip += 1;
          notes.push(`${row.rowNum}행 ${name}: 권한 밖 직원이라 건너뜁니다`);
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: name, action: "skip", summary: "권한 밖" });
          continue;
        }
        const patch: Record<string, unknown> = {};
        const resumeVals: Record<(typeof RESUME_OWNED)[number], string | null> = {
          phone, job_title: jobTitle, department, employment_type: employmentType, hire_date: hireDate,
        };
        for (const col of RESUME_OWNED) {
          const v = resumeVals[col];
          if (v === null) continue;
          const now = cur[col] === null || cur[col] === undefined ? null : String(cur[col]).slice(0, col === "hire_date" ? 10 : undefined);
          if (!now) patch[col] = v;
          else if (now !== v) notes.push(`${row.rowNum}행 ${name}: ${RESUME_LABEL[col]}은(는) 이력서가 기준이라 바꾸지 않았습니다(지금 '${now}')`);
        }
        if (subjects.length && [...subjects].sort().join() !== [...(cur.subjects ?? [])].sort().join()) patch.subjects = subjects;
        if (englishName && englishName !== cur.english_name) patch.english_name = englishName;
        if (memo && memo !== cur.memo) patch.memo = memo;
        if ((cur.display_name ?? "").trim() !== name) notes.push(`${row.rowNum}행: 이름('${cur.display_name ?? ""}' → '${name}')은 이력서에서 바꿔 주세요`);
        if (role && role !== cur.system_role) notes.push(`${row.rowNum}행 ${name}: 역할은 바꾸지 않았습니다(지금 ${ROLE_LABEL[cur.system_role]}) — 계정 관리에서`);
        const changed = Object.keys(patch);
        if (!changed.length) {
          skip += 1;
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: name, action: "skip", summary: "바뀐 칸 없음" });
        } else {
          plan.updates.push({ id: cur.id, label: name, patch });
          preview.push({ sheet: SHEET, rowNum: row.rowNum, key: name, action: "update", summary: `${changed.length}칸 바꿈 · ${email}` });
        }
        continue;
      }
      // 새 직원 — 역할 필수 · 본인보다 엄격히 아래만 · 원장 불가.
      if (!role) {
        row.fail("role", "새 직원은 역할을 적어 주세요");
        continue;
      }
      if (role === "master" || ROLE_HIERARCHY[role] <= actorRank) {
        row.fail("role", `'${ROLE_LABEL[role]}' 역할은 본인 권한으로 줄 수 없습니다 — ${assignableRoles(ctx.user.systemRole).map((r) => ROLE_LABEL[r]).join(" · ")} 중에서`);
        continue;
      }
      const derived = subjects.length ? subjects : subjectsFromDepartment(department, maps.options);
      pending.push({
        row,
        insert: {
          rowNum: row.rowNum,
          email,
          name,
          role,
          profile: { phone, job_title: jobTitle, department, employment_type: employmentType, hire_date: hireDate, subjects: derived, english_name: englishName, memo },
        },
        summary: `${ROLE_LABEL[role]} · ${email}${derived.length ? ` · ${derived.map((k) => maps.labelOf(k)).join(", ")}` : ""} · 계정 생성`,
      });
    }
    // 다른 지점 계정이 쓰는 이메일(로그인 아이디는 전 지점에서 하나) — 새 이메일 행만, 10개씩 동시에(B4 · Auth를 한꺼번에 두드리지 않게).
    // 조회 실패는 false — 최종 방어는 Auth 유니크. 오류는 행마다 같은 칸 위치로 남는다.
    const NO_USER = "00000000-0000-0000-0000-000000000000";
    for (let i = 0; i < pending.length; i += 10) {
      const chunk = pending.slice(i, i + 10);
      const taken = await Promise.all(chunk.map((p) => isLoginEmailTakenElsewhere(admin, p.insert.email, NO_USER)));
      chunk.forEach((p, j) => {
        if (taken[j]) {
          p.row.fail("email", EMAIL_TAKEN_MESSAGE);
          return;
        }
        plan.inserts.push(p.insert);
        preview.push({ sheet: SHEET, rowNum: p.insert.rowNum, key: p.insert.name, action: "insert", summary: p.summary });
      });
    }
    preview.sort((a, b) => a.rowNum - b.rowNum);
    issues.push(...duplicateKeyIssues(SHEET, parsed, (r) => r.key, "이메일"));
    if (plan.inserts.length) notes.push(`새 계정 ${plan.inserts.length}개의 비밀번호는 반영 뒤 직원 상세 › 계정 관리 › '비밀번호 재설정'으로 발급해 전달하세요`);
    return {
      counts: [{ label: "직원", total: sheet?.rows.length ?? 0, insert: plan.inserts.length, update: plan.updates.length, skip }],
      preview,
      notes,
      plan,
    };
  },

  async apply({ ctx, plan }) {
    const admin = createAdminClient();
    let created = 0;
    const done = () => (created ? ` · 그 앞 ${created}명은 계정이 만들어졌습니다` : "");
    for (const r of plan.inserts) {
      const { data: authData, error: authErr } = await admin.auth.admin.createUser({
        email: r.email,
        password: randomPassword(),
        email_confirm: true,
        app_metadata: { tenant_id: ctx.tenantId, system_role: r.role },
      });
      if (authErr || !authData?.user) {
        const why = isEmailTakenAuthError(authErr) ? EMAIL_TAKEN_MESSAGE : (authErr?.message ?? "알 수 없는 오류");
        return { error: `${r.rowNum}행 ${r.name}: 계정을 만들지 못했습니다 — ${why}${done()}` };
      }
      // 미러 트리거가 만든 최소 행을 UPDATE로 보강(insert면 users_pkey 충돌 — createStaff와 같은 이유).
      const { error: dbErr } = await admin
        .from("users")
        .update({ display_name: r.name, system_role: r.role, status: "active", ...r.profile })
        .eq("id", authData.user.id)
        .eq("tenant_id", ctx.tenantId);
      if (dbErr) {
        await admin.auth.admin.deleteUser(authData.user.id);
        await admin.from("users").delete().eq("id", authData.user.id).eq("tenant_id", ctx.tenantId);
        return { error: `${r.rowNum}행 ${r.name}: 직원 정보를 저장하지 못했습니다 — ${dbErr.message}${done()}` };
      }
      created += 1;
    }
    for (const u of plan.updates) {
      const { error } = await admin.from("users").update(u.patch).eq("id", u.id).eq("tenant_id", ctx.tenantId);
      if (error) return { error: `${u.label}을(를) 갱신하지 못했습니다 — ${error.message}${done()}` };
    }
    return {};
  },
};

export default def;
