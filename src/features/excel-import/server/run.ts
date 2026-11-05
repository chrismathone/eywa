import "server-only";
import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { readSheetGrid, type SheetRows } from "../rows";
import { ISSUE_MAX, MAX_BYTES, PREVIEW_MAX, isExcelMode, type ImportIssue, type ImportResult } from "../spec";
import type { ImportCtx, ImporterDef } from "./types";
import { annotateErrors, findSheet, loadWorkbook, sheetGrid } from "./workbook";

/**
 * 가져오기 공통 실행 — 원장 2026-09-29 세 지시(모든 탭 · 추가/덮어쓰기 · 오류 위치)의 한 곳.
 *
 * 흐름: 게이트(full) → 파일 → 시트·열 제목 확인(**서식 불일치 = 업로드 취소 + 어디가 틀렸는지**) → 행 해석 →
 * 기존과 대조(방식별 추가/갱신/건너뜀) → **오류가 하나라도 있으면 아무것도 안 쓴다** → `dryRun`이면 여기서 끝 → 반영.
 * 🔴 반영 요청도 **처음부터 다시 계산한다**(미리보기 결과를 믿지 않는다 — [[#77]] 서버가 게이트).
 * `annotate=1`이면 결과 대신 **오류 칸을 빨갛게 칠한 엑셀**을 돌려준다(route가 파일로 내려준다).
 */
export type RunOutput = { kind: "json"; body: ImportResult; status?: number } | { kind: "file"; buf: Buffer; name: string };

/**
 * 게이트 — 사람 = '다른 강사 뷰'의 대상 직원(`getCurrentUser({ teacherView: true })`, 원장 2026-11-05 강사뷰 전수). 가져온 행의 기록 명의
 * (created_by·작성자·출결 recorded_by)와 역할 판정(직원 가져오기의 줄 수 있는 역할·담당 범위)이 대상 기준이다. '읽기' 강사뷰는
 * canManageTenant(읽기로 캡)가 막는다. 감사로그 행위자는 로그인 계정 그대로(logAction).
 */
export async function gateImport(def: ImporterDef): Promise<ImportCtx | { error: string; status: number }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다", status: 401 };
  if (!(await canManageTenant(user.systemRole, def.menu))) {
    return { error: `${def.title} 엑셀 올리기는 이 메뉴의 전체 권한(관리자 이상)이 있어야 합니다`, status: 403 };
  }
  return { user, tenantId: user.tenantId };
}

export async function runImport(def: ImporterDef, fd: FormData): Promise<RunOutput> {
  const gate = await gateImport(def);
  if ("error" in gate) return { kind: "json", body: { error: gate.error }, status: gate.status };
  const ctx = gate;

  const file = fd.get("file");
  if (!(file instanceof File)) return { kind: "json", body: { error: "엑셀 파일을 선택하세요" } };
  if (file.size > MAX_BYTES) return { kind: "json", body: { error: "파일이 너무 큽니다(5MB까지) — 시트를 나눠 올려 주세요", formatMismatch: true } };
  const modeRaw = String(fd.get("mode") ?? "append");
  if (!isExcelMode(modeRaw)) return { kind: "json", body: { error: "반영 방식이 올바르지 않습니다" } };
  const mode = modeRaw;
  const dryRun = String(fd.get("dryRun") ?? "") === "1";
  const annotate = String(fd.get("annotate") ?? "") === "1";

  const wb = await loadWorkbook(await file.arrayBuffer());
  if (!wb) return { kind: "json", body: { error: "엑셀 파일을 읽지 못했습니다 — .xlsx 형식인지 확인하세요(.xls·.csv는 엑셀에서 '다른 이름으로 저장 → xlsx')", formatMismatch: true } };

  // ── 시트·열 제목(서식) ───────────────────────────────────────────────────────────
  const issues: ImportIssue[] = [];
  const sheets: Record<string, SheetRows<string> | null> = {};
  /** 규약 시트 이름 → 파일의 실제 시트 이름(첫 시트 폴백 · 공백 차이). 가져오기가 규약 이름으로 남긴 오류를 실제 이름으로 고친다. */
  const actualName = new Map<string, string>();
  let foundAny = false;
  const single = def.singleSheet ?? def.sheets.length === 1;
  for (const spec of def.sheets) {
    const ws = findSheet(wb, spec.name, single, spec.aliases);
    if (!ws) {
      sheets[spec.name] = null;
      if (!spec.optional) {
        issues.push({ sheet: spec.name, row: null, col: null, header: null, value: null, message: `'${spec.name}' 시트가 없습니다 — 파일의 시트: ${wb.worksheets.map((w) => w.name).join(", ")}` });
      }
      continue;
    }
    foundAny = true;
    // 시트 이름을 규약 이름으로 맞춘다(오류 위치가 규약 이름을 말해야 annotate가 찾는다 — 폴백으로 읽은 첫 시트 포함).
    const grid = sheetGrid(ws);
    const specForRead = ws.name === spec.name ? spec : { ...spec, name: ws.name };
    if (ws.name !== spec.name) actualName.set(spec.name, ws.name);
    const read = readSheetGrid(specForRead, grid, issues);
    sheets[spec.name] = read;
  }
  const formatIssues = issues.length > 0;
  if (!foundAny || formatIssues) {
    if (annotate) return { kind: "file", buf: await annotateErrors(wb, issues), name: `${def.title}_오류표시.xlsx` };
    return {
      kind: "json",
      body: {
        error: "서식이 일치하지 않습니다 — 아래 위치를 확인하고 [서식 내려받기]로 받은 파일의 시트·열 제목 그대로 적어 주세요",
        formatMismatch: true,
        issues: issues.slice(0, ISSUE_MAX),
        issueTotal: issues.length,
      },
    };
  }
  if (Object.values(sheets).every((s) => !s || s.rows.length === 0)) return { kind: "json", body: { error: "데이터 행이 없습니다(제목 줄 아래가 비어 있습니다)" } };

  // ── 해석 + 대조 ─────────────────────────────────────────────────────────────────
  let out;
  try {
    out = await def.plan({ ctx, mode, sheets, issues });
  } catch (e) {
    return { kind: "json", body: { error: `기존 자료를 불러오지 못했습니다 — ${e instanceof Error ? e.message : String(e)}` } };
  }
  // 🔑 오류 위치는 **파일의 시트 이름**으로 — 'Sheet1'로 올렸는데 '원생' 시트라고 말하면 못 찾고, 오류 표시 파일도 칠할 곳을 못 찾는다.
  for (const i of issues) {
    const real = actualName.get(i.sheet);
    if (real) i.sheet = real;
  }
  for (const r of out.preview) {
    const real = actualName.get(r.sheet);
    if (real) r.sheet = real;
  }
  if (annotate) return { kind: "file", buf: await annotateErrors(wb, issues), name: `${def.title}_오류표시.xlsx` };

  const base: ImportResult = {
    mode,
    counts: out.counts,
    preview: out.preview.slice(0, PREVIEW_MAX),
    notes: out.notes ?? [],
    issues: issues.slice(0, ISSUE_MAX),
    issueTotal: issues.length,
  };
  if (issues.length > 0 || dryRun) return { kind: "json", body: { ...base, dryRun, applied: false } };
  if (out.counts.every((c) => c.insert + c.update === 0)) {
    return { kind: "json", body: { ...base, dryRun: false, applied: false, error: "반영할 행이 없습니다 — 모두 이미 있는 것이라 건너뜁니다('덮어쓰기'를 고르면 파일 값으로 바꿉니다)" } };
  }

  // ── 반영 ───────────────────────────────────────────────────────────────────────
  const res = await def.apply({ ctx, mode, plan: out.plan });
  await logAction({
    action: "excel_import",
    targetType: def.kind,
    targetLabel: `${def.title} · ${file.name}`,
    metadata: {
      kind: def.kind,
      mode,
      file: file.name,
      counts: out.counts.map((c) => ({ label: c.label, insert: c.insert, update: c.update, skip: c.skip })),
      error: res.error ?? null,
    },
  });
  for (const p of def.revalidate) revalidatePath(p);
  if (res.error) return { kind: "json", body: { ...base, notes: [...(base.notes ?? []), ...(res.notes ?? [])], dryRun: false, applied: false, error: res.error } };
  return { kind: "json", body: { ...base, notes: [...(base.notes ?? []), ...(res.notes ?? [])], dryRun: false, applied: true } };
}
