"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import {
  SHUTTLE_ACTION,
  SHUTTLE_INPUT,
  SHUTTLE_ROW,
  SHUTTLE_ROW_TEXT,
} from "@/features/shuttle/control-size";
import {
  DIRECTION_LABEL,
  runTimeRange,
  runTitle,
  type Season,
  type ShuttleRun,
  type ShuttleVehicle,
} from "@/features/shuttle/types";
import { createRun, saveVehicle } from "@/features/shuttle/server/actions";

/**
 * 좌열 — 차량별 회차 목록. 회차를 고르면 가운데 노선이 바뀐다(주소 `?run=`로 들고 있어
 * 새로고침·창 복원에도 보던 회차가 유지된다).
 *
 * 회차 배지 색은 tone에서 고른다(등원=info 진행중 / 하원=special 예외 아님… → 아래 주석 참조).
 */
export function RunColumn({
  season,
  vehicles,
  runs,
  activeRunId,
  canWrite,
  onError,
  onPick,
}: {
  season: Season;
  vehicles: ShuttleVehicle[];
  runs: ShuttleRun[];
  activeRunId: string | null;
  canWrite: boolean;
  onError: (msg: string | null) => void;
  /** 📱 좁은 화면에서 회차를 고르면 '노선' 탭으로 넘긴다(탭 전환은 부모가 소유). */
  onPick: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addingVehicle, setAddingVehicle] = useState(false);

  function submit(fd: FormData, action: (f: FormData) => Promise<{ error?: string } | undefined>) {
    onError(null);
    startTransition(async () => {
      const res = await action(fd);
      if (res?.error) onError(res.error);
      else router.refresh();
    });
  }

  return (
    // ⚠️ `px-1 py-0.5` — 카드 테두리가 `--shadow-card`의 1px 링(박스 밖)이라 `overflow-y-auto`가
    //    좌·우를 깎아 "테두리 짤림"으로 보인다(stop-column과 같은 이유, 원장 2026-08-19).
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-1 py-0.5">
      {vehicles.length === 0 && (
        <p className="text-text-faint px-1 text-[12.5px]">
          차량이 없습니다 — 아래에서 먼저 차량을 만드세요.
        </p>
      )}

      {vehicles.map((v) => {
        const mine = runs.filter((r) => r.vehicleId === v.id);
        return (
          <section key={v.id} className="bg-card rounded-2xl p-3 shadow-[var(--shadow-card)]">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-text text-[13.5px] font-bold">{v.name}</h3>
              {v.driverName && (
                <span className="text-text-faint truncate text-[11.5px]">{v.driverName}</span>
              )}
            </div>

            <ul className="flex flex-col gap-1">
              {mine.map((r) => {
                const riders = r.stops.reduce((n, s) => n + s.riders.length, 0);
                const range = runTimeRange(r.stops);
                const active = r.id === activeRunId;
                return (
                  <li key={r.id}>
                    <Link
                      href={`/shuttle?season=${season}&run=${r.id}`}
                      onClick={onPick}
                      className={`${SHUTTLE_ROW} flex flex-col justify-center gap-0.5 rounded-xl px-2.5 py-2 transition-colors ${
                        active ? "bg-primary-soft" : "hover:bg-muted"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {/* 등원=info(오는 중) · 하원=special(돌려보냄) — 뜻이 다르니 색도 다르다. */}
                        <Pill color={TONE_COLOR[r.direction === "in" ? "info" : "special"]}>
                          {DIRECTION_LABEL[r.direction]}
                        </Pill>
                        <span className={`text-text truncate font-bold ${SHUTTLE_ROW_TEXT}`}>
                          {runTitle(r)}
                        </span>
                      </span>
                      <span className="text-text-faint text-[11.5px]">
                        {range && <span className="num">{range}</span>}
                        {range && " · "}
                        <span className="num">{riders}</span>명
                      </span>
                    </Link>
                  </li>
                );
              })}
              {mine.length === 0 && (
                <li className="text-text-faint px-1 py-1 text-[11.5px]">회차가 없습니다</li>
              )}
            </ul>

            {canWrite && (
              <div className="mt-2 flex gap-1">
                {(["in", "out"] as const).map((dir) => (
                  <Button
                    key={dir}
                    variant="outline"
                    className={SHUTTLE_ACTION}
                    disabled={pending}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("vehicleId", v.id);
                      fd.set("season", season);
                      fd.set("direction", dir);
                      submit(fd, createRun);
                    }}
                  >
                    + {DIRECTION_LABEL[dir]} 회차
                  </Button>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {canWrite &&
        (addingVehicle ? (
          <form
            className="bg-card flex flex-col gap-2 rounded-2xl p-3 shadow-[var(--shadow-card)]"
            action={(fd) => {
              submit(fd, saveVehicle);
              setAddingVehicle(false);
            }}
          >
            <input
              name="name"
              required
              maxLength={40}
              placeholder="차량 이름 (예: 1호차)"
              className={SHUTTLE_INPUT}
            />
            <input
              name="driverName"
              maxLength={40}
              placeholder="기사 이름 (선택)"
              className={SHUTTLE_INPUT}
            />
            <input
              name="driverPhone"
              maxLength={20}
              placeholder="기사 연락처 (선택)"
              className={SHUTTLE_INPUT}
            />
            <div className="flex items-center gap-1">
              <Button type="submit" className={SHUTTLE_ACTION} disabled={pending}>
                추가
              </Button>
              <Button
                type="button"
                variant="ghost"
                className={SHUTTLE_ACTION}
                onClick={() => setAddingVehicle(false)}
              >
                취소
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" className={SHUTTLE_ACTION} onClick={() => setAddingVehicle(true)}>
            + 차량 추가
          </Button>
        ))}
    </div>
  );
}
