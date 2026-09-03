/**
 * 일일 브리핑 카드의 "바로 가기" 목적지 — 순수 함수만(서버·DB 무관, Vitest).
 *
 * 매니저 보고 문장은 LLM이 쓰지만 **링크는 결정론 payload에서만** 만든다. 문장을 되파싱해
 * "여기를 말하는 것 같다"고 추측하면 한 글자만 달라져도 엉뚱한 화면으로 보내게 된다 —
 * 칩은 자기 신호의 라벨·건수를 그대로 달고(`actionCountLabel`) 그 신호가 들고 있는 href로만 간다.
 *
 * 🔴 권한은 화면이 아니라 **호출부의 게이트**가 정한다([[#77]]) — 대시보드가 `todayActions`를 거를 때
 *    쓰는 것과 **같은 술어**(`todayActionGate`)를 넘겨받는다. 브리핑 payload는 master 관점 전신호라
 *    (0114a) 그대로 링크를 깔면 admin/manager에게 눌러도 튕기는 죽은 링크가 생긴다.
 *
 * ⚠️ 영역(area) 배정은 `AREA_BY_MENU`(menuKey → 영역) 하나뿐이다. LLM이 어떤 영역에서 무엇을
 *    언급했는지와 다를 수 있어(실측: '운영' 문단이 반 미배정·발송 실패를 말한다) 칩이 문단과 어긋날
 *    수 있는데, 칩이 **자기 라벨을 달고 있으므로** 거짓 표시는 아니다. 문단이 아예 없는 영역의 칩은
 *    카드가 마지막 줄('바로 가기')에 모아 보여준다 — 신호가 조용히 사라지지 않게.
 */
import type { MenuKey } from "@/lib/permissions";
import type { DailyBriefingPayload } from "./briefing-digest";
import { AREA_BY_MENU, TEAM_AREAS, type TeamArea } from "./briefing-team-report";
import { actionCountLabel, type TodayActionAccess } from "./today-actions";

export type BriefingLink = { key: string; label: string; href: string };
/** 영역별 바로 가기(빈 배열 포함 — 카드가 인덱싱만 하면 되게 항상 5키를 채운다). */
export type BriefingLinks = Record<TeamArea, BriefingLink[]>;

/** 이 사용자가 그 화면을 열 수 있는가 — 대시보드가 넘긴다(`todayActionGate`). */
export type BriefingLinkGate = (menuKey: MenuKey, requiredAccess: TodayActionAccess) => boolean;

export function emptyBriefingLinks(): BriefingLinks {
  return { 수업: [], 학생: [], 상담: [], 수납: [], 운영: [] };
}

export function buildBriefingLinks(
  payload: DailyBriefingPayload | null,
  canOpen: BriefingLinkGate,
): BriefingLinks {
  const links = emptyBriefingLinks();
  if (!payload) return links;
  const push = (area: TeamArea, link: BriefingLink) => {
    // 같은 key가 두 번 들어오면(옛 payload 중복 등) 한 번만 — 칩이 겹쳐 보이지 않게.
    if (links[area].some((existing) => existing.key === link.key)) return;
    links[area].push(link);
  };

  for (const item of payload.attention ?? []) {
    // 옛 payload 방어 — href·menuKey가 없던 시절의 행이면 링크를 만들지 않는다(추측 금지).
    if (!item?.href || !item.menuKey) continue;
    if (!canOpen(item.menuKey, item.requiredAccess ?? "read")) continue;
    push(AREA_BY_MENU[item.menuKey] ?? "운영", {
      key: item.key,
      label: actionCountLabel(item),
      href: item.href,
    });
  }

  // 상담 후속조치는 attention이 아니라 payload.followUps에 따로 있다(집계 축이 다르다).
  // 기한 지남은 상담 목록의 같은 필터(urg=overdue)로 바로 좁혀 준다.
  if (canOpen("consultations", "read")) {
    if (payload.followUps?.overdue > 0) {
      push("상담", {
        key: "followup-overdue",
        label: `후속조치 기한 지남 ${payload.followUps.overdue}건`,
        href: "/consultations?urg=overdue",
      });
    }
    // ⚠️ '오늘·임박'은 urg 필터 한 칸(today/soon)으로 못 좁힌다 — 반쪽만 걸린 링크보다 목록 전체가 정직하다.
    if (payload.followUps?.dueSoon > 0) {
      push("상담", {
        key: "followup-due",
        label: `후속조치 오늘·임박 ${payload.followUps.dueSoon}건`,
        href: "/consultations",
      });
    }
  }

  // 휴가 승인 대기도 attention 밖이다(브리핑이 '오늘 예정'으로 갈라 담는다, briefing-digest 주석).
  if (payload.today?.pendingLeaveApprovals > 0 && canOpen("staff", "manage-staff")) {
    push("운영", {
      key: "leaves-pending",
      label: `휴가 승인 대기 ${payload.today.pendingLeaveApprovals}건`,
      href: "/staff/leaves",
    });
  }

  return links;
}

/**
 * 보고 문단이 없는 영역의 칩 — 카드 마지막 줄에 모아 붙일 목록.
 * (LLM은 "보고할 내용이 없는 영역은 생략"하므로 문단이 3개만 올 수도 있다.)
 */
export function leftoverBriefingLinks(links: BriefingLinks, shownAreas: readonly TeamArea[]): BriefingLink[] {
  const shown = new Set(shownAreas);
  return TEAM_AREAS.filter((area) => !shown.has(area)).flatMap((area) => links[area]);
}
