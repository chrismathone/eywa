// 설명서 생성기 공용 — 목차·면 파일 읽기, 데모 지점 세션.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { isRawModuleEnabled } from "../_shared/module-state.mjs";

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "../..");
export const require = createRequire(path.join(REPO, "package.json"));
export const MANUAL = path.join(REPO, "docs/manual");
export const OUT = path.join(REPO, "out/manual");
export const SHOTS = path.join(OUT, "_shots");
export const BASE = process.env.MANUAL_BASE ?? "http://localhost:3200";
export const DEMO_SLUG = "demo";

export function readToc() {
  return JSON.parse(fs.readFileSync(path.join(MANUAL, "toc.json"), "utf8"));
}

/** 목차를 평평하게: [{ group, gi, menu, mi, face, fi, id: "menu/face" }] */
export function flatFaces(toc = readToc()) {
  const out = [];
  toc.groups.forEach((group, gi) =>
    group.menus.forEach((menu, mi) =>
      menu.faces.forEach((face, fi) =>
        out.push({ group, gi, menu, mi, face, fi, id: `${menu.slug}/${face.slug}`, module: face.module ?? menu.module ?? null }),
      ),
    ),
  );
  return out;
}

/** 'students' · 'students/students' · 없음(전체) → 대상 면 목록 */
export function selectFaces(arg) {
  const all = flatFaces();
  if (!arg) return all;
  const hit = all.filter((f) => f.id === arg || f.menu.slug === arg);
  if (!hit.length) throw new Error(`목차에 없는 면: ${arg}`);
  return hit;
}

export function pagePath(f) {
  return path.join(MANUAL, "pages", f.menu.slug, `${f.face.slug}.json`);
}

export function readPage(f) {
  const p = pagePath(f);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function shotBase(f) {
  return path.join(SHOTS, `${f.menu.slug}__${f.face.slug}`);
}

/** 데모 지점 계정 하나로 일회용 로그인 쿠키를 만든다(비밀번호 없음). role = "master" | "teacher" */
export async function demoSession(role = "master") {
  const { createClient } = require("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: tenant, error: te } = await admin.from("tenants").select("id, slug").eq("slug", DEMO_SLUG).single();
  if (te || !tenant) throw new Error("데모 지점을 찾지 못했습니다.");
  // 역할이 맞고 활성인 데모 지점 계정. 강사는 담당 반이 가장 많은 사람(원스크린이 비지 않게).
  let email;
  if (role === "teacher") {
    const { data: rows } = await admin.from("classes").select("teacher_id").eq("tenant_id", tenant.id).eq("is_active", true).not("teacher_id", "is", null);
    const { data: teachers } = await admin.from("users").select("id, email").eq("tenant_id", tenant.id).eq("system_role", "teacher").eq("status", "active");
    const emailOf = new Map((teachers ?? []).map((u) => [u.id, u.email]));
    const count = new Map();
    for (const r of rows ?? []) { const e = emailOf.get(r.teacher_id); if (e) count.set(e, (count.get(e) ?? 0) + 1); }
    email = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  } else {
    const { data } = await admin.from("users").select("email").eq("tenant_id", tenant.id).eq("system_role", role).limit(1);
    email = data?.[0]?.email;
  }
  if (!email) throw new Error(`데모 지점에 ${role} 계정이 없습니다.`);
  const { data: link, error: e1 } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (e1) throw e1;
  const { data: v, error: e2 } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (e2) throw e2;
  if (v.user.app_metadata?.tenant_id !== tenant.id) throw new Error("데모 지점 계정이 아닙니다 — 실데이터 촬영을 막기 위해 멈춥니다.");
  const ref = new URL(url).hostname.split(".")[0];
  const raw = "base64-" + Buffer.from(JSON.stringify(v.session)).toString("base64url");
  const host = new URL(BASE).hostname;
  const name = `sb-${ref}-auth-token`;
  const cookies = [];
  if (raw.length <= 3180) cookies.push({ name, value: raw, domain: host, path: "/" });
  else for (let i = 0; i * 3180 < raw.length; i++) cookies.push({ name: `${name}.${i}`, value: raw.slice(i * 3180, (i + 1) * 3180), domain: host, path: "/" });
  return { cookies, admin, tenantId: tenant.id };
}

/** 상세 화면 주소의 :id 를 채운다 — 설명하기 좋은(데이터가 있는) 데모 지점 행을 고른다. */
export const RESOLVERS = {
  async firstClass({ admin, tenantId }) {
    const { data } = await admin.from("enrollments").select("class_id, classes!inner(is_active, tenant_id)").eq("classes.tenant_id", tenantId).eq("classes.is_active", true).is("end_date", null).limit(1000);
    const c = new Map(); for (const r of data ?? []) c.set(r.class_id, (c.get(r.class_id) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  },
  async firstStudent({ admin, tenantId }) {
    const { data } = await admin.from("enrollments").select("student_id, students!inner(status, tenant_id)").eq("students.tenant_id", tenantId).eq("students.status", "enrolled").is("end_date", null).limit(1000);
    const c = new Map(); for (const r of data ?? []) c.set(r.student_id, (c.get(r.student_id) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  },
  async firstTeacher({ admin, tenantId }) {
    const { data } = await admin.from("users").select("id").eq("tenant_id", tenantId).eq("system_role", "teacher").limit(1);
    return data?.[0]?.id;
  },
};

export async function moduleEnabled(admin, tenantId, module) {
  if (!module) return true;
  const { data } = await admin.from("tenant_settings").select("data").eq("tenant_id", tenantId).maybeSingle();
  return isRawModuleEnabled(data?.data, module);
}
