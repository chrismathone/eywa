"use client";

import { toast } from "sonner";
import { reissueShareLink, revokeShareLink } from "../server/actions";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent } from "../types";
import type { SubjectReport } from "./report-card";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/** 카드의 학부모 공유 링크 취소·재발급 — 수정 계획 P3-O batch D, `use-report-send.ts`에서 나눔(본문 그대로). */
export function useReportShareLinks({
  selected,
  reports,
  i18n: { t, tf },
  patchReport,
  readonlyBlocked,
}: {
  selected: OneScreenStudent | null;
  reports: ReportsState;
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
  patchReport: (studentId: string, subjectName: string, fn: (r: SubjectReport) => SubjectReport) => void;
  readonlyBlocked: () => boolean;
}) {
  // 공유링크 취소(revoke) — 학부모 열람 즉시 차단. 대상은 그 과목의 현재 shareToken.
  async function revokeShare(subjectName: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    const token = reports[selected.id]?.[subjectName]?.shareToken;
    if (!token) return;
    const student = selected;
    const res = await revokeShareLink(token);
    if (!res.ok) {
      toast.error(res.error ?? t("os.c.revokeFail"));
      return;
    }
    patchReport(student.id, subjectName, (r) => ({ ...r, revoked: true }));
    toast.success(tf("os.c.revoked", { subject: subjectName }));
  }

  // 공유링크 재발급(reissue) — 새 토큰. 옛 링크(카톡/문자/ClassNote 게시)는 즉시 무효화되므로 확인 후 실행.
  async function reissueShare(subjectName: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    const token = reports[selected.id]?.[subjectName]?.shareToken;
    if (!token) return;
    if (!window.confirm(t("os.c.reissueConfirm"))) return;
    const student = selected;
    const res = await reissueShareLink(token);
    if (!res.ok || !res.shareToken) {
      toast.error(res.error ?? t("os.c.reissueFail"));
      return;
    }
    // 새 토큰 반영 + 취소·ClassNote 상태 초기화(재발급=미발송으로 되돌림).
    patchReport(student.id, subjectName, (r) => ({
      ...r,
      shareToken: res.shareToken,
      revoked: false,
      classnoteStatus: null, // 명시적 해제(undefined=미확인과 구분 — effectiveClassnoteStatus)
    }));
    toast.success(tf("os.c.reissued", { subject: subjectName }));
  }
  return { revokeShare, reissueShare };
}
