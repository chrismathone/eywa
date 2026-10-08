"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { SystemRole } from "@/lib/permissions";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { catalogAuditTarget, diffCatalogItem, type CatalogAuditSnapshot } from "../catalog-audit";

export type CatalogActionState = { error?: string; ok?: boolean } | undefined;

// 수납 쓰기 권한 = billing "full" (master/admin/accountant). readonly(manager)·none 제외.
async function canWrite(role: SystemRole): Promise<boolean> {
  return (await accessLevelTenant(role, "billing")) === "full";
}

type Fields = {
  title: string;
  bookDetail: string | null;
  gradeLevel: string | null;
  subject: string | null;
  publisher: string | null;
  price: string;
  error?: string;
};

/**
 * 단가표 한 줄의 감사용 모습 — 과목은 **화면 라벨**로 바꾼다(감사 화면에 `math` 같은 키가 새지 않게).
 * 감사로그(원장 2026-10-08 *"교재 목록 수정에 감사로그 붙여줘"*): 단가표가 바뀌어도 지난 신청 금액은 그대로(스냅샷)라,
 * "왜 신청 금액과 단가표가 다른가"의 답은 **단가표를 누가 언제 고쳤나**뿐이다.
 */
async function snapshotOf(row: {
  title?: string | null;
  book_detail?: string | null;
  grade_level?: string | null;
  subject?: string | null;
  publisher?: string | null;
  price?: number | string | null;
}): Promise<CatalogAuditSnapshot> {
  const subject = row.subject ? buildSubjectMaps((await getTenantSettings()).operations.subjects).labelOf(row.subject) : null;
  return {
    title: row.title ?? null,
    bookDetail: row.book_detail ?? null,
    gradeLevel: row.grade_level ?? null,
    subject,
    publisher: row.publisher ?? null,
    price: row.price ?? null,
  };
}

const ROW_COLS = "title, book_detail, grade_level, subject, publisher, price, is_active";

function readForm(formData: FormData): Fields {
  const title = String(formData.get("title") ?? "").trim();
  const bookDetail = String(formData.get("bookDetail") ?? "").trim() || null;
  const gradeLevel = String(formData.get("gradeLevel") ?? "").trim() || null;
  const subject = String(formData.get("subject") ?? "").trim() || null;
  const publisher = String(formData.get("publisher") ?? "").trim() || null;
  const price = String(formData.get("price") ?? "").trim() || "0";
  return { title, bookDetail, gradeLevel, subject, publisher, price, error: title ? undefined : "교재명을 입력해주세요" };
}

export async function createCatalogItem(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "단가표 관리 권한이 없습니다" };

  const f = readForm(formData);
  if (f.error) return { error: f.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("textbook_catalog")
    .insert({
      tenant_id: user.tenantId,
      title: f.title,
      book_detail: f.bookDetail,
      grade_level: f.gradeLevel,
      subject: f.subject,
      publisher: f.publisher,
      price: f.price,
    });
  if (error) return { error: error.message };
  const snap = await snapshotOf({
    title: f.title, book_detail: f.bookDetail, grade_level: f.gradeLevel, subject: f.subject, publisher: f.publisher, price: f.price,
  });
  await logAction({
    action: "textbook_catalog_create",
    targetType: "textbook_catalog",
    targetLabel: catalogAuditTarget(snap),
    metadata: { target: catalogAuditTarget(snap), price: Number(f.price) || 0 },
  });

  revalidatePath("/billing");
  return { ok: true };
}

export async function updateCatalogItem(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "단가표 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "교재 ID가 누락되었습니다" };
  const f = readForm(formData);
  if (f.error) return { error: f.error };

  const supabase = await createClient();
  // 바꾸기 **전** 값 — 감사로그에 "21,000원 → 22,500원"을 남기려면 먼저 읽어야 한다(행이 덮이면 끝이다).
  const { data: beforeRow } = await supabase.from("textbook_catalog").select(ROW_COLS).eq("id", id).maybeSingle();
  const { error } = await supabase
    .from("textbook_catalog")
    .update({
      title: f.title,
      book_detail: f.bookDetail,
      grade_level: f.gradeLevel,
      subject: f.subject,
      publisher: f.publisher,
      price: f.price,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  {
    const before = await snapshotOf(beforeRow ?? {});
    const after = await snapshotOf({
      title: f.title, book_detail: f.bookDetail, grade_level: f.gradeLevel, subject: f.subject, publisher: f.publisher, price: f.price,
    });
    const changes = diffCatalogItem(before, after);
    // 아무것도 안 바뀐 저장은 남기지 않는다(같은 사실로 로그가 부풀지 않게).
    if (changes.length > 0) {
      await logAction({
        action: "textbook_catalog_update",
        targetType: "textbook_catalog",
        targetLabel: catalogAuditTarget(after),
        metadata: { target: catalogAuditTarget(before.title ? before : after), changes },
      });
    }
  }

  revalidatePath("/billing");
  return { ok: true };
}

export async function deleteCatalogItem(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "단가표 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "교재 ID가 누락되었습니다" };

  const supabase = await createClient();
  // 지우기 전 값 — 지운 뒤엔 행에서 되짚을 수 없다.
  const { data: beforeRow } = await supabase.from("textbook_catalog").select(ROW_COLS).eq("id", id).maybeSingle();
  const { error } = await supabase.from("textbook_catalog").delete().eq("id", id);
  if (error) return { error: error.message };
  {
    const before = await snapshotOf(beforeRow ?? {});
    await logAction({
      action: "textbook_catalog_delete",
      targetType: "textbook_catalog",
      targetLabel: catalogAuditTarget(before),
      metadata: { target: catalogAuditTarget(before), price: Number(before.price ?? 0) || 0 },
    });
  }

  revalidatePath("/billing");
  return { ok: true };
}

export async function toggleCatalogActive(
  _prev: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWrite(user.systemRole))) return { error: "단가표 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const next = String(formData.get("next") ?? "") === "true";
  if (!id) return { error: "교재 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: beforeRow } = await supabase.from("textbook_catalog").select(ROW_COLS).eq("id", id).maybeSingle();
  const { error } = await supabase.from("textbook_catalog").update({ is_active: next }).eq("id", id);
  if (error) return { error: error.message };
  {
    const before = await snapshotOf(beforeRow ?? {});
    await logAction({
      action: "textbook_catalog_toggle",
      targetType: "textbook_catalog",
      targetLabel: catalogAuditTarget(before),
      metadata: { target: catalogAuditTarget(before), active: next },
    });
  }

  revalidatePath("/billing");
  return { ok: true };
}
