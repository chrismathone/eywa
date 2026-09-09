"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { isLinkedSource } from "../linked";
import { FALLBACK_CATEGORY, nextCategoryKey } from "../categories";
import { logAction } from "@/features/audit/server/log";
import { documentCategoriesTag } from "./category-queries";

// 서식 저장소 분류 관리(0161a) — 학원장/관리자가 분류를 추가·이름변경·순서변경·삭제한다.
// 쓰기 게이트는 문서와 동일한 canWriteTenant("documents")(master/admin/manager 기본).
//
// ⚠️ 시스템 분류(is_system)는 **삭제만** 막는다 — 이름·순서는 바꿔도 안전하지만(키가 진실),
//    삭제하면 코드가 직접 쓰는 고정 대상(이력서→'hr', 환불요청서→'billing')이 고아 키가 된다.

export type CategoryActionState = { ok?: boolean; error?: string; nonce?: number } | undefined;

const MAX_LABEL = 20;

async function gate() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "documents"))) {
    return { error: "분류를 관리할 권한이 없습니다" as const };
  }
  return { user };
}

/** 변경 후 캐시 무효화 — 분류는 tenantId별 unstable_cache라 태그를 비워야 폴더가 즉시 바뀐다. */
function invalidate(tenantId: string) {
  updateTag(documentCategoriesTag(tenantId)); // server action 전용 read-your-writes(즉시)
  revalidatePath("/documents");
}

function parseLabel(v: unknown): { label: string } | { error: string } {
  const label = String(v ?? "").trim().replace(/\s+/g, " ");
  if (!label) return { error: "분류 이름을 입력하세요" };
  if (label.length > MAX_LABEL) return { error: `분류 이름은 ${MAX_LABEL}자 이내로 입력하세요` };
  return { label };
}

/** 분류 추가 — 학원장은 이름만 입력하고 내부 키는 앱이 `cat_N`으로 확정(불변). */
export async function createDocumentCategory(
  _prev: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  const parsed = parseLabel(formData.get("label"));
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { data: existing, error: readErr } = await supabase
    .from("document_categories")
    .select("key, label, sort_order");
  if (readErr) return { error: `분류 조회 실패: ${readErr.message}` };
  const rows = existing ?? [];

  // 같은 이름이 이미 있으면 거부 — 폴더 팬에 구분 안 되는 쌍둥이가 생긴다(과목 편집기와 같은 규칙).
  if (rows.some((r) => r.label === parsed.label)) {
    return { error: `이미 "${parsed.label}" 분류가 있습니다` };
  }
  const key = nextCategoryKey(rows.map((r) => r.key));
  // 방어 — 연동 폴더(교재 요청서·수강료 견적서)와 같은 `?cat=` 네임스페이스를 쓴다. 키가 겹치면
  // 연동 분기가 먼저 이겨 조용히 엉뚱한 폴더가 열린다. `cat_` 접두사라 실제로는 도달 불가.
  if (isLinkedSource(key)) return { error: "분류 키 생성에 실패했습니다 — 다시 시도해 주세요" };

  const maxOrder = rows.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0);
  const { error } = await supabase.from("document_categories").insert({
    tenant_id: g.user.tenantId,
    key,
    label: parsed.label,
    sort_order: maxOrder + 10, // 새 분류는 맨 아래
    is_system: false,
  });
  if (error) return { error: `분류 추가 실패: ${error.message}` };
  await logAction({
    action: "document_category_create",
    targetType: "document_category",
    targetLabel: parsed.label,
    metadata: { key, label: parsed.label },
  });
  invalidate(g.user.tenantId);
  return { ok: true, nonce: Date.now() };
}

/** 이름 변경 — 키는 건드리지 않는다(기존 문서 연결 보존). 시스템 분류도 이름은 바꿀 수 있다. */
export async function renameDocumentCategory(
  _prev: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  const key = String(formData.get("key") ?? "");
  if (!key) return { error: "잘못된 요청입니다" };
  const parsed = parseLabel(formData.get("label"));
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { data: rows, error: readErr } = await supabase.from("document_categories").select("key, label");
  if (readErr) return { error: `분류 조회 실패: ${readErr.message}` };
  if (!rows?.some((r) => r.key === key)) return { error: "분류를 찾을 수 없습니다" };
  // 바꾸기 **전** 이름 — 고친 뒤엔 어디에도 안 남아서 "무엇이 무엇으로"를 되짚을 수 없다.
  const before = rows?.find((r) => r.key === key)?.label ?? null;
  if (rows.some((r) => r.key !== key && r.label === parsed.label)) {
    return { error: `이미 "${parsed.label}" 분류가 있습니다` };
  }

  const { data: updated, error } = await supabase
    .from("document_categories")
    .update({ label: parsed.label, updated_at: new Date().toISOString() })
    .eq("key", key)
    .select("key"); // select 없으면 0행 갱신도 성공으로 보고된다.
  if (error) return { error: `이름 변경 실패: ${error.message}` };
  if (!updated?.length) return { error: "분류를 찾을 수 없습니다" };
  await logAction({
    action: "document_category_rename",
    targetType: "document_category",
    targetLabel: parsed.label,
    metadata: { key, from: before, to: parsed.label },
  });
  invalidate(g.user.tenantId);
  return { ok: true, nonce: Date.now() };
}

/** 표시 순서 한 칸 이동 — 이웃과 sort_order를 교환한 뒤 전체를 10 간격으로 정규화. */
export async function moveDocumentCategory(
  key: string,
  direction: "up" | "down",
): Promise<{ ok?: boolean; error?: string }> {
  const g = await gate();
  if ("error" in g) return { error: g.error };

  const supabase = await createClient();
  const { data, error: readErr } = await supabase
    .from("document_categories")
    .select("key, label, sort_order")
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true });
  if (readErr) return { error: `분류 조회 실패: ${readErr.message}` };
  const rows = data ?? [];
  const idx = rows.findIndex((r) => r.key === key);
  if (idx < 0) return { error: "분류를 찾을 수 없습니다" };
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= rows.length) return { ok: true }; // 끝 — 조용히 무시(버튼은 disabled)

  const ordered = [...rows];
  [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
  // 두 행만 갱신하면 기존 값이 중복(둘 다 10 등)일 때 순서가 안 바뀐다 → 전체를 10 간격으로 다시 매긴다.
  const results = await Promise.all(
    ordered.map((r, i) =>
      supabase
        .from("document_categories")
        .update({ sort_order: (i + 1) * 10, updated_at: new Date().toISOString() })
        .eq("key", r.key),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: `순서 변경 실패: ${failed.error.message}` };
  await logAction({
    action: "document_category_move",
    targetType: "document_category",
    targetLabel: rows[idx].label ?? null,
    metadata: { key, direction, fromIndex: idx + 1, toIndex: swap + 1, total: rows.length },
  });
  invalidate(g.user.tenantId);
  return { ok: true };
}

/**
 * 삭제 — 반드시 **다른 분류로 이동한 뒤** 지운다(absorbSubject 선례). 그냥 지우면 그 분류의 문서들이
 * 어느 폴더에도 안 잡히는 고아가 된다. 시스템 분류는 삭제 불가.
 */
export async function deleteDocumentCategory(
  key: string,
  absorbInto: string,
): Promise<{ ok?: boolean; error?: string; moved?: number }> {
  const g = await gate();
  if ("error" in g) return { error: g.error };
  if (!key) return { error: "잘못된 요청입니다" };

  const supabase = await createClient();
  const { data: rows, error: readErr } = await supabase
    .from("document_categories")
    .select("key, label, is_system");
  if (readErr) return { error: `분류 조회 실패: ${readErr.message}` };
  const target = rows?.find((r) => r.key === key);
  if (!target) return { error: "분류를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다" };
  if (target.is_system) {
    return { error: `"${target.label}"은(는) 기본 분류라 삭제할 수 없습니다 — 이름은 바꿀 수 있습니다` };
  }

  // 이동 대상 검증 — 없는 키로 옮기면 지금 막은 고아를 그대로 만드는 셈. 미지정이면 '기타'로.
  const into = absorbInto && absorbInto !== key ? absorbInto : FALLBACK_CATEGORY;
  if (!rows?.some((r) => r.key === into)) return { error: "옮길 분류를 선택하세요" };

  // ① 문서를 먼저 옮기고 ② 분류를 지운다. 순서가 반대면 이동 실패 시 고아가 남는다.
  // 건수는 update의 `.select()` 길이로 세지 않는다 — PostgREST가 1000행에서 잘라 34건이 영원히 "1000"이
  // 되는 상한-길이-오독([[#89]]). UPDATE 자체는 전 행에 적용되므로 별도 count로 정확히 센다(B2).
  const { count: toMove } = await supabase
    .from("academy_documents")
    .select("*", { count: "exact", head: true })
    .eq("category", key);
  const { error: moveErr } = await supabase
    .from("academy_documents")
    .update({ category: into, updated_at: new Date().toISOString() })
    .eq("category", key);
  if (moveErr) return { error: `문서 이동 실패: ${moveErr.message}` };

  const { data: deleted, error } = await supabase
    .from("document_categories")
    .delete()
    .eq("key", key)
    .select("key");
  if (error) return { error: `분류 삭제 실패: ${error.message}` };
  if (!deleted?.length) return { error: "분류를 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다" };

  // 🔴 지운 분류 이름은 여기서 스냅샷(행이 사라지면 key만으로는 무엇이었는지 못 읽는다).
  //    옮긴 문서 건수까지 남겨야 "그때 12건이 기타로 갔다"를 나중에 확인할 수 있다.
  await logAction({
    action: "document_category_delete",
    targetType: "document_category",
    targetLabel: target.label,
    metadata: {
      key,
      absorbedInto: into,
      absorbedIntoLabel: rows?.find((r) => r.key === into)?.label ?? null,
      movedDocuments: toMove ?? 0,
    },
  });
  invalidate(g.user.tenantId);
  return { ok: true, moved: toMove ?? 0 };
}
