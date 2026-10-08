/**
 * 성적관리 › 영어 › JJ실 — **짝 잇기** 구역(관리자 전용, 서버 컴포넌트).
 *
 * 인재원 학생 중 아직 aywa 학생과 이어지지 않은 사람을 모아 후보를 보여 준다. 잇는 것은 사람이 고르고 확인한다
 * (이름만으로 자동 연결 금지 — 인재원엔 생년월일·학교가 없다). 표보다 늦게 와도 되도록 따로 스트리밍한다.
 * 조회 실패는 이 구역에 배너 한 줄로만 — JJ 표까지 끌고 내려가지 않는다(getIjwLinkSuggestions는 던지지 않는다).
 */
import { getIjwLinkSuggestions, type JjViewer } from "@/features/ijw/server/queries";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { JjFailBanner } from "./jj-shared";
import { JjLinkPanel, type JjLinkRow, type JjPoolOption } from "./jj-link-panel";
import { JjProfilePushButton } from "./jj-profile-push-button";

const labelOf = (s: { name: string; school: string | null; grade: string | null; classNames?: readonly string[] }) =>
  [s.name, schoolGradeLabel(s.school, s.grade), (s.classNames ?? []).join(", ")].filter(Boolean).join(" · ");

export async function JjLinkSection({ viewer }: { viewer: JjViewer }) {
  if (!viewer.canLink) return null;
  const res = await getIjwLinkSuggestions(viewer.tenantId);
  if (!res.ok) return <JjFailBanner message={res.message} detail={res.detail} />;
  if (res.columnMissing) return null;
  // 학교·학년·생일 보내기(원장 2026-10-08) — 이을 짝이 없어도(전원 이어진 상태) 버튼은 남는다.
  if (res.suggestions.length === 0) return <JjProfilePushButton />;
  const rows: JjLinkRow[] = res.suggestions.map((s) => ({
    ijwId: s.ijw.ijwId,
    ijwName: s.ijw.name || s.ijw.ijwId,
    className: s.ijw.className,
    uniqueId: s.unique?.id ?? null,
    uniqueLabel: s.unique ? labelOf(s.unique) : null,
    // `sameClass`(인재원 반과 같은 반)는 동명이인을 가르는 가장 강한 단서라 화면까지 그대로 나른다.
    candidates: s.candidates.map((c) => ({
      id: c.id,
      label: labelOf(c),
      reason: c.reason,
      sameClass: c.sameClass,
    })),
  }));
  const pool: JjPoolOption[] = res.pool.map((s) => ({ id: s.id, label: labelOf(s) }));
  return (
    <div className="flex flex-col gap-3">
      <JjProfilePushButton />
      <JjLinkPanel rows={rows} pool={pool} />
    </div>
  );
}
