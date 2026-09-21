"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { canonicalSchoolName } from "@/features/schools/school-name";
import { getTenantSettings } from "@/features/owner/server/queries";
import { resolveUniqueStudentNameFor } from "./unique-name";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { logAction } from "@/features/audit/server/log";
import {
  classifyRows,
  fieldForHeader,
  naturalKey,
  normalizePhone,
  normalizeStatus,
  type ClassifiedRow,
  type ImportField,
  type ImportSummary,
  type ParsedRow,
} from "../lib/student-import";

async function requireStudentWrite() {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "로그인이 필요합니다" };
  const lvl = await accessLevelTenant(user.systemRole, "students");
  // 🔴 full만 — 강사(scoped)는 학생 열람 전용(원장 지시 2026-08-18, 학생 상세 퇴원·수정 차단과 같은 결).
  if (lvl !== "full") return { user: null, error: "학생 등록 권한이 없습니다 — 강사 계정은 열람 전용입니다" };
  return { user, error: undefined as string | undefined };
}

/** ExcelJS 셀 값 → 문자열(richText·formula result·hyperlink·날짜·숫자 안전화). */
function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    if (o.result != null) return String(o.result);
    return String(v);
  }
  return String(v);
}

export type StudentImportPreview = {
  error?: string;
  rows?: ClassifiedRow[];
  summary?: ImportSummary;
};

/**
 * 업로드 xlsx 첫 시트를 파싱해 신규/중복/오류로 분류(읽기 전용, DB 미변경).
 * 헤더는 우리 내보내기 형식(이름/학년/학교/상태/연락처)을 인식. '이름' 열 필수.
 */
export async function previewStudentImport(formData: FormData): Promise<StudentImportPreview> {
  const { user, error } = await requireStudentWrite();
  if (error || !user) return { error };
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "파일을 선택해주세요" };
  // 학교명 저장 별칭은 학원설정 값(침산 = 일중→대구일중, 새 학원 = 없음) — 미리보기와 저장이 같은 규칙을 쓴다.
  const schoolAliases = (await getTenantSettings()).operations.schoolSaveAliases;

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) return { error: "시트를 찾을 수 없습니다" };

    // 1행 = 헤더 → 컬럼→필드 매핑
    const fieldByCol = new Map<number, ImportField>();
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
      const f = fieldForHeader(cellText(cell.value));
      if (f) fieldByCol.set(col, f);
    });
    if (![...fieldByCol.values()].includes("name")) {
      return { error: "'이름' 열을 찾을 수 없습니다 (aywa 내보내기 형식인지 확인하세요)" };
    }

    const parsed: ParsedRow[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const rowObj = ws.getRow(r);
      const f: Partial<Record<ImportField, string>> = {};
      for (const [col, field] of fieldByCol) f[field] = cellText(rowObj.getCell(col).value).trim();
      // 완전 빈 행은 건너뜀
      if (!f.name && !f.grade && !f.school && !f.parentPhone && !f.studentPhone) continue;
      parsed.push({
        rowNum: r,
        name: f.name ?? "",
        grade: f.grade || null,
        // 🔴 미리보기 단계에서 정규화해야 중복 판정(자연키)이 실제 저장값과 같은 기준이 된다.
        school: canonicalSchoolName(f.school, schoolAliases),
        status: normalizeStatus(f.status),
        parentPhone: f.parentPhone || null,
        studentPhone: f.studentPhone || null,
        englishName: f.englishName || null,
      });
    }
    if (parsed.length === 0) return { error: "데이터 행이 없습니다" };

    // 기존 활성 학생 자연키 — 중복 판정용(전건 페이지네이션, 1000행 절단 회피).
    const supabase = await createClient();
    const existing = await fetchAllPaged<{ name: string; school: string | null; grade: string | null }>(
      (from, to) =>
        supabase.from("students").select("name, school, grade").neq("status", "withdrawn").range(from, to),
    );
    const existingKeys = new Set(existing.map((s) => naturalKey(s.name, s.school, s.grade)));

    const { rows, summary } = classifyRows(parsed, existingKeys);
    return { rows, summary };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "엑셀 파싱 실패" };
  }
}

export type ImportInsertRow = {
  name: string;
  school: string | null;
  grade: string | null;
  status: string;
  parentPhone: string | null;
  studentPhone: string | null;
  englishName: string | null;
};

export type StudentImportResult = {
  error?: string;
  inserted?: number;
  skipped?: number;
  failed?: number;
  /** 동명이인이라 접미사(A·B·C)가 붙은 항목 "원본 → 저장된 이름". 조용히 바꾸지 않고 결과에 보여준다. */
  renamed?: string[];
};

/**
 * 미리보기에서 신규로 분류된 행을 등록. 행별 insert(전화 정규화·상태 변환) — 중복(DB 부분 유니크)은 건너뜀.
 * 모든 쓰기는 RLS(테넌트 격리) 하 — 조작된 행도 본 테넌트를 벗어나지 못함.
 */
export async function applyStudentImport(rows: ImportInsertRow[]): Promise<StudentImportResult> {
  const { user, error } = await requireStudentWrite();
  if (error || !user) return { error };
  if (!Array.isArray(rows) || rows.length === 0) return { error: "등록할 학생이 없습니다" };
  const schoolAliases = (await getTenantSettings()).operations.schoolSaveAliases;

  const supabase = await createClient();
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  // 동명이인이라 접미사(A·B·C)가 붙은 건수 — 조용히 이름이 바뀌면 나중에 못 찾는다(결과에 명시).
  const renamed: string[] = [];

  for (const r of rows) {
    const name = String(r?.name ?? "").trim();
    if (!name) {
      failed += 1;
      continue;
    }
    // 동명이인 접미사 — 수동 등록·상담 전환과 **같은 규칙**(한 경로만 지키면 소용없다).
    // 행마다 조회하는 이유: 같은 파일 안에 동명이인이 여러 줄 있으면 직전 줄이 만든 이름까지 봐야 한다.
    const uniqueName = await resolveUniqueStudentNameFor(supabase, user.tenantId, name);
    const { error: insErr } = await supabase.from("students").insert({
      tenant_id: user.tenantId,
      name: uniqueName.name,
      school: canonicalSchoolName(r.school, schoolAliases),
      grade: r.grade?.trim() || null,
      status: normalizeStatus(r.status),
      parent_phone: normalizePhone(r.parentPhone),
      student_phone: normalizePhone(r.studentPhone),
      english_name: r.englishName?.trim() || null,
    });
    if (insErr) {
      if (/duplicate key|natural_key/i.test(insErr.message)) skipped += 1;
      else failed += 1;
    } else {
      inserted += 1;
      if (uniqueName.suffixed) renamed.push(`${name} → ${uniqueName.name}`);
    }
  }

  await logAction({
    action: "student_import",
    targetType: "student",
    metadata: { inserted, skipped, failed, renamed: renamed.length },
  });
  revalidatePath("/students");
  return { inserted, skipped, failed, renamed };
}
