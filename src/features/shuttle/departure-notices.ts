/**
 * 학부모 **셔틀 알림** 줄(0368a·0368b, 사용자 2026-10-07 — 진짜 앱 푸시의 가정판) — 순수 함수(IO 없음, Vitest).
 *
 * 세 가지가 뜬다:
 *  · **차량 출발**(`depart`) — 회차가 출발하면(`shuttle_trips.started_at`) 그 회차에 오늘 타는 우리 아이가 있을 때.
 *  · **등원 탑승**(`board`) — 셔틀 선생님이 [탑승]→[전송]으로 그 아이 등원 탑승을 저장했을 때(`shuttle_boardings`).
 *  · **등원 미탑승**(`missed`) — [미탑승]→[전송](사용자 2026-10-07 "아이가 탑승하지 않았습니다"). 사유(직원 메모)는 싣지 않는다.
 *  · **하원 하차**(`dropoff`) — 하원 줄 [하차]→[전송](사용자 2026-10-07). 그 줄의 정류장이 내린 곳이다.
 * 학부모가 [확인]을 누른 (날짜·회차·알림 키)는 내린다.
 *
 * 🔑 알림은 저장하지 않고 도출한다 — 오늘 구간(`RideLeg`)이 이미 "누가 어느 회차에 타나 + 운행 상태 + 탑승 기록"을
 *    들고 있다. 그래서 '타지 않기'·결석한 날은 출발해도 알림이 없고, 선생님이 [취소]→[전송]으로 탑승 기록을
 *    지우면 탑승 알림도 함께 사라진다.
 * 🔑 출발은 형제가 같은 회차면 **한 줄**(같은 차 출발을 두 번 알리지 않는다). 탑승은 **아이마다** 한 줄.
 * 🔑 셔틀 [저장](0368c `notify_parent=false`)으로 찍은 탑승·미탑승은 기록만 하고 알리지 않는다 — [전송]만 알린다.
 * 🔑 [등원 안함](그날만 안 탐, 0229a)은 기록이 아니라 예정 변경이라 `skipped` — 어떤 알림도 없다(저장만).
 * 🔑 하원 기록은 '탔다'가 아니라 '내렸다'라 탑승 알림이 아니라 **하차 알림**이다(하원엔 미탑승이 없다 — 버튼이 [하차] 하나).
 * 🔑 종료된 회차도 확인 전까지 남는다 — 푸시는 읽을 때까지 쌓여 있는 것이다.
 */
import type { Direction } from "./types";
import type { RideLeg } from "./parent-rides";

export type ParentNoticeKind = "depart" | "board" | "missed" | "dropoff";

export type ParentNotice = {
  kind: ParentNoticeKind;
  /** 확인 표식의 키(0368b `notice_key`) — 'depart' · 'board:<학생 id>' · 'miss:<학생 id>' · 'drop:<학생 id>'. */
  noticeKey: string;
  runId: string;
  direction: Direction;
  vehicleName: string;
  runName: string;
  /** 탑승·하차 정류장(출발 알림엔 없음). */
  stopName: string | null;
  /** 출발 또는 기록 시각 "HH:MM"(KST). */
  time: string | null;
  /** 해당 아이 이름(자녀 순서). 탑승 알림은 한 명. */
  kids: string[];
};

const RECORD_KEY_PREFIX: Record<ParentNoticeKind, string> = { depart: "depart", board: "board", missed: "miss", dropoff: "drop" };

/** 확인 표식 조회 키 — (회차, 알림 키). */
export const noticeAckId = (runId: string, noticeKey: string) => `${runId}|${noticeKey}`;

export function parentNotices(
  children: readonly { id: string; name: string }[],
  legs: ReadonlyMap<string, readonly RideLeg[]>,
  acked: ReadonlySet<string>,
): ParentNotice[] {
  const departs = new Map<string, ParentNotice>();
  const boards: ParentNotice[] = [];
  for (const child of children) {
    for (const leg of legs.get(child.id) ?? []) {
      if (leg.skipped) continue;
      const base = { runId: leg.runId, direction: leg.direction, vehicleName: leg.vehicleName, runName: leg.runName };

      // 🔑 키를 탑승/미탑승으로 가른다 — 미탑승을 확인한 뒤 [취소]→[탑승]으로 고쳐 보내면 탑승 알림은 새로 떠야 한다.
      const rode = leg.status === "boarded" || leg.status === "extra";
      const kind: ParentNoticeKind | null =
        leg.direction === "out" ? (rode ? "dropoff" : null) : rode ? "board" : leg.status === "missed" ? "missed" : null;
      const recordKey = kind ? `${RECORD_KEY_PREFIX[kind]}:${child.id}` : null;
      if (kind && recordKey && leg.notifyParent && !acked.has(noticeAckId(leg.runId, recordKey))) {
        boards.push({ ...base, kind, noticeKey: recordKey, stopName: leg.stopName, time: leg.recordedTime, kids: [child.name] });
      }

      if ((leg.trip === "running" || leg.trip === "done") && !acked.has(noticeAckId(leg.runId, "depart"))) {
        const notice = departs.get(leg.runId);
        if (notice) {
          if (!notice.kids.includes(child.name)) notice.kids.push(child.name);
        } else {
          departs.set(leg.runId, { ...base, kind: "depart", noticeKey: "depart", stopName: null, time: leg.tripStartedTime, kids: [child.name] });
        }
      }
    }
  }
  // 최근이 위 — 방금 온 푸시가 맨 위에 쌓이듯. 같은 시각이면 탑승·미탑승이 출발보다 위(나중 일이다).
  const late = (n: ParentNotice) => (n.kind === "depart" ? 1 : 0);
  return [...boards, ...departs.values()].sort((a, b) => (b.time ?? "").localeCompare(a.time ?? "") || late(a) - late(b));
}

/** 알림 한 줄 문장. */
export function parentNoticeText(n: ParentNotice): string {
  const car = [n.vehicleName, n.runName].filter(Boolean).join(" ");
  if (n.kind === "board") return `${n.kids.join("·")} 학생이 지금 ${car} 차량을 탔습니다`;
  // 하차는 **어디서** 내렸나가 핵심이라 정류장을 문장에 넣고, 차 이름은 둘째 줄(departure-notice-list)로 내린다.
  if (n.kind === "dropoff") return `${n.kids.join("·")} 학생이 ${n.stopName ?? car}에서 내렸습니다`;
  if (n.kind === "missed") return `${n.kids.join("·")} 학생이 ${car} 차량에 탑승하지 않았습니다`;
  const io = n.direction === "in" ? "등원" : "하원";
  return `${n.kids.join("·")} ${io} — ${car} 차량이 출발했습니다`;
}
