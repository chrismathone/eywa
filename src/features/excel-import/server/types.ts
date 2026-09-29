import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { MenuKey } from "@/lib/permissions";
import type { SheetRows } from "../rows";
import type { ExcelMode, ImportCounts, ImportIssue, ImportPreviewRow, SheetSpec } from "../spec";
import type { TemplateSheet } from "./workbook";

/** 가져오기 한 벌을 정의하는 모양 — 파일 읽기·방식·미리보기·전부 또는 전무·감사로그·재검증은 `run.ts`가 공통으로 한다. */
export type ImportCtx = { user: CurrentUser; tenantId: string };

export type PlanOutput<P> = {
  counts: ImportCounts[];
  preview: ImportPreviewRow[];
  notes?: string[];
  /** 반영 단계에 넘길 계획(직렬화 안 한다 — 같은 요청 안에서만 산다). */
  plan: P;
};

export type ApplyOutput = { error?: string; notes?: string[] };

export type ImporterDef<P = unknown> = {
  kind: string;
  /** 화면·파일 이름(예: "원생"). */
  title: string;
  /** 쓰기 게이트 메뉴 — 학원 전체를 바꾸는 일괄 작업이라 **full(관리자 계열)만** 통과(`canManageTenant`). */
  menu: MenuKey;
  sheets: readonly SheetSpec[];
  /** 시트가 하나면 이름이 달라도 첫 시트로 읽는다(기존 시스템에서 내보낸 파일). */
  singleSheet?: boolean;
  /** 방식 설명 — 화면 라디오 옆에 적는다. */
  modeHelp: Record<ExcelMode, string>;
  /** 안내 시트 머리 줄들. */
  guide: readonly string[];
  /** 지금 데이터를 담은 서식(덮어쓰기로 고쳐 올릴 수 있게). 빈 서식이면 rows를 비운다. */
  template(ctx: ImportCtx): Promise<TemplateSheet[]>;
  /** 행 해석 + 기존과 대조 → 미리보기. 오류는 `issues`에 위치로. */
  plan(input: {
    ctx: ImportCtx;
    mode: ExcelMode;
    sheets: Record<string, SheetRows<string> | null>;
    issues: ImportIssue[];
  }): Promise<PlanOutput<P>>;
  apply(input: { ctx: ImportCtx; mode: ExcelMode; plan: P }): Promise<ApplyOutput>;
  /** 반영 뒤 다시 그릴 경로. */
  revalidate: readonly string[];
};
