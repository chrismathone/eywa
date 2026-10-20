import { redirect } from "next/navigation";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { OperationsProvider } from "@/features/owner/operations-context";
import { emptyResume } from "@/features/staff/resume/resume";
import { findIntakeTokenByToken, isTokenOpen } from "@/features/staff/intake/server/intake-token";
import { expiredLinkHref } from "@/features/link-expired/kinds";
import { PublicStaffForm } from "./public-staff-form";

export const metadata = { title: "직원 등록" };

/** 학원이 끈 QR·없는 토큰·읽을 수 없는 마감일 — 그 자리 안내(만료 페이지로 보내지 않는다). */
function ClosedStaffIntakeScreen() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-foreground text-lg font-bold">등록을 받을 수 없습니다</p>
      <p className="text-text-dim text-sm">유효하지 않거나 종료된 등록 링크입니다.</p>
    </div>
  );
}

/**
 * 직원 등록 QR 공개 페이지(원장 지시 2026-08-07) — 비인증. 토큰이 유일한 자격증명이자 테넌트 해석 키다.
 * 학부모 공개접수((intake)/intake/[token])와 같은 크롬리스 레이아웃을 쓰되 **다른 토큰 저장소**를 본다
 * (intake_tokens엔 용도 컬럼이 없어 섞으면 학부모 링크로 직원이 등록된다 — intake-token.ts 주석 참조).
 *
 * ⚠️ 서식(ResumeSheet)이 학원설정 기반 훅(useSubjectMaps·useJobTitleResolver)을 쓰므로 **OperationsProvider로
 *    감싸야 한다** — (shell) 레이아웃이 주입하던 것을 여기선 이 페이지가 직접 준다(안 감싸면 런타임 크래시).
 */
export default async function PublicStaffIntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const tok = await findIntakeTokenByToken(token);

  if (!tok || !tok.active) return <ClosedStaffIntakeScreen />;
  if (!isTokenOpen(tok)) {
    // 켜져 있는데 닫힘 = 마감일 갈래 → 공용 '링크 만료' 페이지로 307(원장 2026-10-01). 주소엔 종류만(토큰 금지).
    // 🔴 마감일을 **읽을 수 있을 때만** 만료로 본다 — 깨진 값은 isTokenOpen이 닫힘으로 보지만 "기간이 지났다"는 사실이
    //    아니다(입학 접수 `isIntakeExpired`도 못 읽는 값은 만료로 치지 않는다). 그 경우는 그 자리 화면.
    if (Number.isFinite(Date.parse(tok.expiresAt ?? ""))) redirect(expiredLinkHref("staff"));
    return <ClosedStaffIntakeScreen />;
  }

  const settings = await getTenantSettingsByTenantId(tok.tenantId);

  return (
    <OperationsProvider
      subjects={settings.operations.subjects}
      gradeLevels={settings.operations.gradeLevels}
      jobTitles={settings.operations.jobTitles}
      jobTitlesByDepartment={settings.operations.jobTitlesByDepartment}
    >
      <PublicStaffForm
        data={emptyResume()}
        token={token}
        academyName={settings.profile.name || "학원"}
      />
    </OperationsProvider>
  );
}
