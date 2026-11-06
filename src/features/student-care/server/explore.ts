import "server-only";
import { z } from "zod";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstDateOf } from "@/lib/date-kst";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { MenuKey } from "@/lib/permissions";
import { EVIDENCE_KIND_LABEL, careHref, evidenceHref, type CareEvidenceKind, type CareRecord } from "../model";
import { careAccess } from "./access";
import { careFailureOf, isCareStorageMissing } from "./errors";
import { careRow, readStudentCareRows } from "./queries";

/**
 * 연결 탐색(`/explore`) '약속·할 일' 조각이 읽는 경계 — 이 원생의 약속(최신 버전 · 진행 중 먼저 · 목표일 순).
 * 권한·담당 범위는 약속 관리 화면과 같은 문(`careAccess` — 강사는 자기에게 배정된 약속만).
 * 실패는 까닭별로 돌려준다(`state`) — 표가 없으면 unavailable(SQL 미적용 · #95), 권한 밖이면 denied, 그 밖은 error. 0건으로 꾸미지 않는다.
 * 첫 화면은 증거 후보(상담·보고서·시트 목록)를 읽지 않는다 — '기록 추가' 창이 열릴 때 `listCareEvidenceOptions`가 읽는다.
 */
export type CareExploreView = {
  state: "ready" | "unavailable" | "denied" | "error";
  commitments: CareCommitmentView[]; // 최신 버전 기준 · 진행 중 먼저 · 목표일 순
  canManage: boolean; canContribute: boolean;
  careHref: string; // 이 원생의 약속 관리 화면(/students/<id>/care)
  intake: { id: string; title: string; date: string | null; body: string | null; href: string } | null; // 입학상담의 학부모 요구 한 건(있으면)
};
export type CareCommitmentView = {
  id: string; version: number; revision: number; state: "open" | "completed" | "cancelled";
  promise: string; need: string; criterion: string; dueOn: string; subject: string;
  ownerName: string | null; acknowledged: boolean; closedOn: string | null; closedByName: string | null;
  evidence: { kind: string; kindLabel: string; recordId: string; note: string; at: string; href: string | null }[];
};

/** 증거 원본을 여는 메뉴 — 이 메뉴를 못 여는 사람에겐 링크를 주지 않는다(종류·메모만). */
const EVIDENCE_MENU: Record<CareEvidenceKind, MenuKey> = { consultation: "consultations", lesson_report: "lesson_reports", english_sheet: "ecs", math_sheet: "mcs" };
const STATE_RANK = { open: 0, completed: 1, cancelled: 2 } as const;

export async function getStudentCareForExplore(studentId: string): Promise<CareExploreView> {
  const base: CareExploreView = { state: "error", commitments: [], canManage: false, canContribute: false, careHref: careHref(studentId), intake: null };
  if (!z.string().uuid().safeParse(studentId).success) return base;
  let access: Awaited<ReturnType<typeof careAccess>>;
  try {
    access = await careAccess(studentId);
  } catch (error) {
    return { ...base, state: careFailureOf(error) };
  }
  const flags = { canManage: access.actor.canManage, canContribute: access.actor.canContribute };
  const [rows, menus, intake] = await Promise.all([
    readStudentCareRows(access, studentId, 0),
    evidenceMenus(access.user),
    exploreIntake(access.user, studentId).catch(() => null),
  ]);
  if (rows.error) return { ...base, ...flags, intake, state: isCareStorageMissing(rows.error) ? "unavailable" : "error" };
  let records: CareRecord[];
  try {
    records = (rows.data ?? []).slice(0, 100).map(careRow);
  } catch {
    return { ...base, ...flags, intake, state: "error" };
  }
  const names = await staffNames(access.user.tenantId, records).catch(() => new Map<string, string>());
  const commitments = records.map((record) => commitmentView(record, names, menus))
    .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id));
  return { ...base, ...flags, intake, state: "ready", commitments };
}

function commitmentView(record: CareRecord, names: Map<string, string>, menus: Record<CareEvidenceKind, boolean>): CareCommitmentView {
  const doc = record.document;
  return {
    id: record.id, version: record.version, revision: doc.revision, state: doc.state,
    promise: doc.content.promise, need: doc.content.need, criterion: doc.content.criterion, dueOn: doc.content.dueOn, subject: doc.content.subject,
    ownerName: names.get(doc.content.ownerId) ?? null, acknowledged: !!doc.acknowledged,
    closedOn: doc.closed ? kstDateOf(doc.closed.at) : null, closedByName: doc.closed ? names.get(doc.closed.by) ?? null : null,
    // 이번 버전의 기록만 — 완료 판정과 같은 기준(이전 버전의 기록은 새 버전의 근거가 아니다 · model.ts careStatus).
    evidence: doc.evidence.filter((e) => e.revision === doc.revision).map((e) => ({
      kind: e.kind, kindLabel: EVIDENCE_KIND_LABEL[e.kind], recordId: e.recordId, note: e.note, at: e.at,
      href: menus[e.kind] ? evidenceHref(e.kind, e.recordId) : null,
    })),
  };
}

async function evidenceMenus(user: CurrentUser): Promise<Record<CareEvidenceKind, boolean>> {
  const kinds = Object.keys(EVIDENCE_MENU) as CareEvidenceKind[];
  const allowed = await Promise.all(kinds.map((kind) => canAccessTenant(user.systemRole, EVIDENCE_MENU[kind])));
  return Object.fromEntries(kinds.map((kind, i) => [kind, allowed[i]])) as Record<CareEvidenceKind, boolean>;
}

/** 담당자·완료 확인자 이름 — 약속 문서에 적힌 직원만(이 지점). */
async function staffNames(tenantId: string, records: CareRecord[]): Promise<Map<string, string>> {
  const ids = [...new Set(records.flatMap((r) => [r.document.content.ownerId, ...(r.document.closed ? [r.document.closed.by] : [])]))];
  const admin = createAdminClient();
  const rows = await fetchInChunks<{ id: string; display_name: string | null }>(ids, (chunk) =>
    admin.from("users").select("id,display_name").eq("tenant_id", tenantId).in("id", chunk));
  return new Map(rows.filter((r) => r.display_name?.trim()).map((r) => [String(r.id), String(r.display_name).trim()]));
}

/** 신규 콜&상담의 학부모 요구(가장 최근 한 건) — 신규 콜&상담을 열 수 있는 사람에게만. 실패하면 없는 것으로(약속 표시는 그대로). */
async function exploreIntake(user: CurrentUser, studentId: string): Promise<CareExploreView["intake"]> {
  if (!(await canAccessTenant(user.systemRole, "enrollment"))) return null;
  const { data, error } = await (await createClient()).from("enrollment_consultations")
    .select("id,parent_request,consultation_date,created_at").eq("tenant_id", user.tenantId).eq("student_id", studentId)
    .not("parent_request", "is", null).neq("parent_request", "")
    .order("created_at", { ascending: false }).order("id").limit(1).maybeSingle();
  if (error || !data) return null;
  const id = String(data.id);
  return {
    id, title: "신규 콜&상담 · 학부모 요구",
    date: (data.consultation_date ? String(data.consultation_date).slice(0, 10) : null) ?? kstDateOf(data.created_at),
    body: String(data.parent_request ?? "").trim() || null, href: `/enrollment/${id}`,
  };
}
