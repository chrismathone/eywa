/**
 * 침산 '관리자'(과목 운영형) 운영실 배치를 **원장 배치와 똑같이** 맞춘다(원장 2026-10-19 *"관리자 대시보드를 원장과 동일하게
 * 맞추고 과목별 커팅해"* → *"디폴트를 바꾸라는게 아님"*).
 * · 코드 기본(`defaults.ts`)은 그대로 — 학원 설정 '대시보드 관리'에 저장되는 침산의 관리자 배치만 바꾼다.
 * · 원장 배치 = 편집기의 '원장 배치로 바꾸기'와 같은 값(원장 저장값이 있으면 그것, 없으면 `defaultItems("owner")`).
 * · 과목별로 자르는 것은 이미 켜져 있다 — 과목 운영형 관리자는 담당 과목 값만 본다(`overview/server.ts` `addSliced`).
 * · 저장은 화면 저장과 같은 함수(`mergeDashboardSave` → `normalizeDashboard`)를 지나고, 같은 감사 기록(`owner_settings_update`)을 남긴다.
 * · 금액·전화번호 가림 옵션은 건드리지 않는다(과목 운영형 기본 = 가림 — 원장이 카드에서 켠다).
 *
 * 실행: `ENV_FILE=<.env.local> npx tsx scripts/_oneoff/copy-owner-dashboard-to-subject-admins.mts [--apply]`
 * 미리 보기가 기본. 적용 전 대시보드 섹션을 `--backup=<파일>`(기본: 표준 출력에 요약만)로 남길 수 있다.
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: process.env.ENV_FILE });
const { createClient } = await import("@supabase/supabase-js");
const { defaultItems } = await import("../../src/features/dashboard/layout/defaults");
const { mergeDashboardSave, normalizeDashboard, layoutKey } = await import("../../src/features/dashboard/layout/normalize");
const { diffSettingsSection } = await import("../../src/features/owner/settings-diff");
const { nextSettingsStamp } = await import("../../src/features/owner/settings-stamp");
const { SECTION_LABELS } = await import("../../src/features/owner/settings-types");

const APPLY = process.argv.includes("--apply");
const BACKUP = process.argv.find((a) => a.startsWith("--backup="))?.slice("--backup=".length);
const TENANT_SLUG = "cs";
const ACTOR = { id: "94007db7-12d3-4b5d-97f2-39071446536b", name: "원일" };
const DIRECTIVE = "관리자 대시보드를 원장과 동일하게 맞추고 과목별 커팅해 · 디폴트를 바꾸라는게 아님";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: tenant, error: tErr } = await db.from("tenants").select("id, name").eq("slug", TENANT_SLUG).single();
if (tErr || !tenant) throw tErr ?? new Error("지점을 찾지 못했습니다");
const { data: row, error: sErr } = await db.from("tenant_settings").select("data, updated_at").eq("tenant_id", tenant.id).single();
if (sErr || !row) throw sErr ?? new Error("학원 설정 행이 없습니다");

const data = (row.data ?? {}) as Record<string, unknown>;
const before = normalizeDashboard(data.dashboard);
const ownerItems = before.layouts.find((l) => l.role === "owner" && !l.subject)?.items ?? defaultItems("owner");

// 관리자(과목 운영형) 배치 키 = 공통 + 이미 저장된 과목별 배치 전부(지금 침산 = 영어·수학).
const subjectKeys = [...new Set(["subject", ...before.layouts.filter((l) => l.role === "subject" && l.subject).map((l) => layoutKey("subject", l.subject))])];
const submitted = {
  ...before,
  layouts: [
    ...before.layouts.filter((l) => l.role !== "subject"),
    ...subjectKeys.map((key) => {
      const subject = key.startsWith("subject:") ? key.slice("subject:".length) : undefined;
      return { role: "subject" as const, ...(subject ? { subject } : {}), items: ownerItems.map((i) => ({ ...i })) };
    }),
  ],
};
const after = normalizeDashboard(mergeDashboardSave(data.dashboard, submitted, "layouts", subjectKeys), { dropDefaults: true });

const summary = (d: typeof before) =>
  d.layouts.map((l) => `${layoutKey(l.role, l.subject)} ${l.items.filter((i) => !i.id.startsWith("heading:")).length}칸`).join(" · ");
console.log(`지점: ${tenant.name} · 바꿀 배치: ${subjectKeys.join(", ")} · 원장 배치 ${ownerItems.length}칸(${before.layouts.some((l) => l.role === "owner") ? "원장 저장값" : "원장 기본"})`);
console.log(`지금: ${summary(before)}`);
console.log(`바꾼 뒤: ${summary(after)}`);
const untouched = (d: typeof before) => JSON.stringify({ ...d, layouts: d.layouts.filter((l) => l.role !== "subject") });
if (untouched(before) !== untouched(after)) throw new Error("관리자 밖 배치·직원 배정이 바뀌는 계산입니다 — 멈춥니다");
// 변경 내역은 정리한 값끼리 비교한다 — DB(jsonb)는 키 순서를 바꿔 두어 원본과 비교하면 안 바뀐 배치도 '변경'으로 잡힌다.
const diff = diffSettingsSection("dashboard", before, after);
console.log("변경 내역:", JSON.stringify(diff));

if (BACKUP) {
  writeFileSync(BACKUP, JSON.stringify({ tenant_id: tenant.id, updated_at: row.updated_at, dashboard: data.dashboard ?? null }, null, 2));
  console.log(`적용 전 대시보드 섹션을 남겼습니다: ${BACKUP}`);
}
if (!APPLY) {
  console.log("미리 보기만 했습니다(--apply 없음).");
} else {
  const { data: written, error: wErr } = await db
    .from("tenant_settings")
    .update({ data: { ...data, version: 1, dashboard: after }, updated_by: ACTOR.id, updated_at: nextSettingsStamp(row.updated_at) })
    .eq("tenant_id", tenant.id)
    .eq("updated_at", row.updated_at)
    .select("tenant_id");
  if (wErr) throw wErr;
  if (!written?.length) throw new Error("읽은 뒤 다른 저장이 먼저 들어왔습니다 — 다시 실행하세요");
  const { error: aErr } = await db.from("audit_logs").insert({
    tenant_id: tenant.id,
    actor_id: ACTOR.id,
    actor_name: ACTOR.name,
    action: "owner_settings_update",
    target_type: "tenant_settings",
    target_label: SECTION_LABELS.dashboard,
    metadata: { section: "dashboard", ...(diff.changes.length ? { changes: diff.changes } : {}), ...(diff.others ? { others: diff.others } : {}), via: "cli", directive: DIRECTIVE },
  });
  if (aErr) throw aErr;
  console.log("바꿨습니다 — 설정 캐시는 5분 안에 새 값으로 바뀝니다.");
}
