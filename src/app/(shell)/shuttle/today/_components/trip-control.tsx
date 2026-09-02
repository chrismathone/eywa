"use client";

import { useTransition } from "react";
import { Pill } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { kstTimeOf } from "@/lib/date-kst";
import { SHUTTLE_ACTION } from "@/features/shuttle/control-size";
import { endTrip, reopenTrip, startTrip } from "@/features/shuttle/server/actions";
import {
  canEndTrip,
  canReopenTrip,
  canStartTrip,
  tripState,
  TRIP_STATE_LABEL,
  TRIP_TONE,
} from "@/features/shuttle/trip-state";
import type { ShuttleTrip } from "@/features/shuttle/types";

/**
 * 회차 하나의 **출발 / 종료**(0242a) — 회차 머리 아래 한 줄.
 *
 * 🔑 이게 있어야 관제 화면에서 빈 회차의 뜻이 갈린다 — 종전엔 아무 기록도 없는 회차가 ① 아직 출발
 *    전이라 당연히 빈 것 ② 출발했는데 아무도 안 찍는 것, 두 가지를 다 뜻했다. 전자는 정상이고
 *    후자는 전화할 일이다(trip-state.ts 머리 주석).
 *
 * 🔴 **표가 없으면(0242a 미적용) 아무것도 그리지 않는다** — 실제로 돌고 있는 차를 "출발 전"이라고
 *    말하지 않기 위해서다. 없는 기능을 버튼으로 약속하지도 않는다([[#95]], 0229a와 같은 규약).
 * 🔴 **종료는 미기록이 남아도 막지 않는다** — 차는 이미 들어왔는데 화면이 거부하면 사실과 어긋난다.
 *    대신 관제가 그 회차를 '미기록 남음'으로 표시한다(막는 대신 보이게).
 * ⚠️ 판정(`canStartTrip` 등)은 순수 모듈에서 오고, **서버 액션이 같은 판정을 다시 한다**([[#77]]).
 */
export function TripControl({
  trip,
  ready,
  runId,
  date,
  today,
  canWrite,
  onError,
  onDone,
}: {
  trip: ShuttleTrip | null;
  /** 0242a 적용 여부. false면 이 컴포넌트는 아무것도 그리지 않는다. */
  ready: boolean;
  runId: string;
  date: string;
  /** KST 오늘 — 지난 날짜·미래 날짜는 읽기만 한다. */
  today: string;
  canWrite: boolean;
  onError: (msg: string | null) => void;
  onDone: () => void;
}) {
  const [busy, startTransition] = useTransition();
  const state = tripState(trip);

  if (!ready) return null;

  function run(action: (fd: FormData) => Promise<{ error?: string } | undefined>) {
    onError(null);
    const fd = new FormData();
    fd.set("ranOn", date);
    fd.set("runId", runId);
    startTransition(async () => {
      const res = await action(fd);
      if (res?.error) onError(res.error);
      else onDone();
    });
  }

  const startedAt = kstTimeOf(trip?.startedAt);
  const endedAt = kstTimeOf(trip?.endedAt);

  return (
    <div className="border-line-faint flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-3 py-2">
      {/* 의미색 캐논: 진행중=info(blue) · 완료=positive(green) · 아직 아무 일 없음=inert(neutral).
          🔴 '출발 전'과 '종료'를 같은 회색으로 두지 말 것 — 정반대 상태가 한눈에 구분돼야 한다. */}
      <Pill color={TONE_COLOR[TRIP_TONE[state]]}>{TRIP_STATE_LABEL[state]}</Pill>

      {/* 🔴 시각은 KST로 찍는다 — `iso.slice(11,16)`은 UTC라 "13:46 출발"이 "04:46"으로 보인다. */}
      {startedAt && (
        <span className="text-text-dim text-[11.5px]">
          <span className="num">{startedAt}</span> 출발
          {trip?.startedByName && ` · ${trip.startedByName}`}
        </span>
      )}
      {endedAt && (
        <span className="text-text-dim text-[11.5px]">
          · <span className="num">{endedAt}</span> 종료
          {trip?.endedByName && ` · ${trip.endedByName}`}
        </span>
      )}

      {canWrite && (
        <span className="ml-auto flex items-center gap-1.5">
          {canStartTrip(state, date, today) && (
            <Button className={SHUTTLE_ACTION} disabled={busy} onClick={() => run(startTrip)}>
              출발
            </Button>
          )}
          {canEndTrip(state, date, today) && (
            <Button
              variant="outline"
              className={SHUTTLE_ACTION}
              disabled={busy}
              onClick={() => run(endTrip)}
            >
              종료
            </Button>
          )}
          {/* 잘못 누른 한 번에 그날 남은 명단을 못 찍으면 안 된다([[#103]] — 잠금은 되돌릴 문과 함께). */}
          {canReopenTrip(state, date, today) && (
            <Button
              variant="outline"
              className={SHUTTLE_ACTION}
              disabled={busy}
              onClick={() => run(reopenTrip)}
            >
              종료 취소
            </Button>
          )}
        </span>
      )}
    </div>
  );
}
