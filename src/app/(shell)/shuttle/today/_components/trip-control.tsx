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
 * 회차 하나의 **출발 / 종료**(0243a) — 회차 머리 줄 **오른쪽 끝에 인라인**으로 붙는다.
 *
 * 🔑 이게 있어야 관제 화면에서 빈 회차의 뜻이 갈린다 — 종전엔 아무 기록도 없는 회차가 ① 아직 출발
 *    전이라 당연히 빈 것 ② 출발했는데 아무도 안 찍는 것, 두 가지를 다 뜻했다. 전자는 정상이고
 *    후자는 전화할 일이다(trip-state.ts 머리 주석).
 *
 * 📐 **2026-09-03 밀도 개선**: 종전엔 이 컴포넌트가 회차마다 **줄 하나를 통째로** 먹었다
 *    (회차 16개 × 40px ≈ 640px). 머리 줄 안으로 넣고 두 가지를 덜어냈다:
 *    · 🔴 **'출발 전' 배지를 버튼과 함께 띄우지 않는다** — 버튼에 "출발"이라고 적혀 있으면 상태는
 *      말 안 해도 안다. 같은 말을 두 번 하느라 폭을 쓰던 자리다. **누를 수 없는 사람에게만**
 *      배지를 남긴다(열람 전용에겐 상태가 유일한 정보다).
 *    · 시각·누가 눌렀는지는 **운행 중·종료일 때만** — 출발 전에는 있지도 않다. 이름은 툴팁으로
 *      내렸다(줄에 늘 붙어 있으면 회차 이름을 밀어낸다).
 *
 * 🔴 **표가 없으면(0243a 미적용) 아무것도 그리지 않는다** — 실제로 돌고 있는 차를 "출발 전"이라고
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
  /** 0243a 적용 여부. false면 이 컴포넌트는 아무것도 그리지 않는다. */
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

  // 🔴 시각은 KST로 찍는다 — `iso.slice(11,16)`은 UTC라 "13:46 출발"이 "04:46"으로 보인다.
  const startedAt = kstTimeOf(trip?.startedAt);
  const endedAt = kstTimeOf(trip?.endedAt);
  const showStart = canWrite && canStartTrip(state, date, today);
  const showEnd = canWrite && canEndTrip(state, date, today);
  const showReopen = canWrite && canReopenTrip(state, date, today);
  /**
   * 상태 배지를 띄울까 — **누를 버튼이 '출발'뿐일 때는 안 띄운다**(버튼이 이미 그 말을 한다).
   * 운행 중·종료는 배지가 시각을 데리고 다니므로 정보가 하나 더 있다.
   */
  const showBadge = state !== "ready" || !showStart;

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {showBadge && <Pill color={TONE_COLOR[TRIP_TONE[state]]}>{TRIP_STATE_LABEL[state]}</Pill>}
      {state !== "ready" && startedAt && (
        <span
          className="text-text-faint hidden text-xs sm:inline"
          title={[
            `${startedAt} 출발${trip?.startedByName ? ` · ${trip.startedByName}` : ""}`,
            endedAt ? `${endedAt} 종료${trip?.endedByName ? ` · ${trip.endedByName}` : ""}` : null,
          ]
            .filter(Boolean)
            .join(" / ")}
        >
          <span className="num">{startedAt}</span>
          {endedAt && (
            <>
              ~<span className="num">{endedAt}</span>
            </>
          )}
        </span>
      )}
      {showStart && (
        <Button className={SHUTTLE_ACTION} disabled={busy} onClick={() => run(startTrip)}>
          출발
        </Button>
      )}
      {showEnd && (
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
      {showReopen && (
        <Button
          variant="outline"
          className={SHUTTLE_ACTION}
          disabled={busy}
          onClick={() => run(reopenTrip)}
          title="실수로 종료를 눌렀을 때 되돌립니다"
        >
          종료 취소
        </Button>
      )}
    </span>
  );
}
