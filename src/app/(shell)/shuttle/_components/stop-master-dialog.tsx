"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { cn } from "@/lib/utils";
import { SHUTTLE_ACTION, SHUTTLE_INPUT } from "@/features/shuttle/control-size";
import {
  DIRECTION_LABEL,
  hasCoords,
  runTitle,
  type ShuttleRun,
  type ShuttleStop,
  type ShuttleVehicle,
} from "@/features/shuttle/types";
import {
  archiveStop,
  createStop,
  saveStopLocation,
  updateStop,
} from "@/features/shuttle/server/actions";
import { StopLocationEditor } from "./stop-location-editor";

/**
 * 정류장 마스터 관리 — **여기가 정류장 이름의 유일한 자리**다.
 *
 * makeedu는 행선지가 노선마다 자유 텍스트라 같은 곳이 최대 5벌로 갈려 있었다(실측 2026-08-19:
 * "서대구 센트럴 자이 112동상가"/"112동 상가"/"센트럴자이 112동 상가"…). 그래서 여기서 이름을
 * 고치면 그 정류장을 쓰는 모든 노선이 함께 바뀐다 — 노선 화면에서는 이름을 못 고친다(일부러).
 *
 * 🔑 **'노선 N곳'을 누르면 그 노선이 펼쳐진다**(원장 2026-08-19: *"눌렀을 때 노선 나왔으면"*).
 *    숫자만 있으면 "이 정류장을 지금 어디서 쓰는지" 확인하러 노선을 하나씩 열어봐야 했다.
 *    ⚠️ 이 숫자·목록은 **지금 보고 있는 시즌**(학기중/방학중) 기준이다 — 보드가 그 시즌만 싣는다.
 *    그래서 '정리'가 막히는 근거도 함께 보인다(다른 시즌에서 쓰는 정류장은 서버가 따로 막는다).
 *
 * ⚠️ 같은 아파트 앞이라도 **승차 지점이 반대편이면 다른 정류장**이다(실제로 "서희스타힐스 앞(cu건너)"과
 *    "…(칠성고맞은편)"이 그렇게 갈려 있었다) — 그 구분은 메모 칸에 적는다.
 *
 * ⚠️ `position:fixed` 오버레이를 **flex로 센터링**한다 — `-translate-x-1/2`를 쓰면 안에서 열리는
 *    dnd-kit DragOverlay 좌표가 밀린다([[#98]]).
 */
export function StopMasterDialog({
  stops,
  runs,
  vehicles,
  seasonLabel,
  coordsReady,
  onClose,
  onError,
}: {
  stops: ShuttleStop[];
  runs: ShuttleRun[];
  vehicles: ShuttleVehicle[];
  seasonLabel: string;
  /**
   * 0243a(좌표 컬럼) 적용 여부. 🔴 false면 위치 입력을 **아예 그리지 않는다** — 없는 기능을 버튼으로
   * 약속하면 눌렀을 때 한글 에러만 나온다([[#95]], 0229a `exceptionsReady`와 같은 규약).
   */
  coordsReady: boolean;
  onClose: () => void;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [openStop, setOpenStop] = useState<string | null>(null);
  /** 위치 패널을 편 정류장 — 이름 수정(`editing`)과 다른 축이라 따로 둔다(둘을 같이 열 수 있다). */
  const [locating, setLocating] = useState<string | null>(null);

  /**
   * 좌표를 아직 안 찍은 정류장 수 — 실측 23곳 중 대부분이 미지정이라 **몇 곳 남았는지**가 보여야
   * 한 번에 훑어 채울 수 있다(하나씩 열어 확인하면 끝이 안 난다).
   */
  const missingCoords = useMemo(
    () => (coordsReady ? stops.filter((s) => !hasCoords(s)).length : 0),
    [stops, coordsReady],
  );

  /** 정류장 → 그 정류장을 쓰는 노선 칸들(차량·회차·시각·인원). 보드가 이미 실어 온 값이라 왕복 0. */
  const usageByStop = useMemo(() => {
    const vehicleName = new Map(vehicles.map((v) => [v.id, v.name]));
    const map = new Map<
      string,
      { key: string; vehicle: string; run: string; direction: string; time: string | null; riders: number }[]
    >();
    for (const run of runs) {
      for (const st of run.stops) {
        if (!st.stopId) continue;
        const list = map.get(st.stopId) ?? [];
        list.push({
          key: st.id,
          vehicle: vehicleName.get(run.vehicleId) ?? "",
          run: runTitle(run),
          direction: DIRECTION_LABEL[run.direction],
          time: st.atTime,
          riders: st.riders.length,
        });
        map.set(st.stopId, list);
      }
    }
    return map;
  }, [runs, vehicles]);

  function submit(fd: FormData, action: (f: FormData) => Promise<{ error?: string } | undefined>) {
    onError(null);
    startTransition(async () => {
      const res = await action(fd);
      if (res?.error) onError(res.error);
      else {
        setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 rounded-2xl p-4 shadow-xl">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-foreground text-[15px] font-bold">정류장 관리</h2>
          <Button variant="ghost" className={SHUTTLE_ACTION} onClick={onClose}>
            닫기
          </Button>
        </div>
        <p className="text-text-faint text-[11.5px]">
          이름은 여기서만 고칩니다 — 고치면 이 정류장을 쓰는 모든 노선이 함께 바뀝니다. 같은 아파트
          앞이라도 승차 지점이 반대편이면 각각 만들고 메모로 구분하세요.
        </p>
        {/* 🔑 미지정이 몇 곳인지 먼저 말한다 — 좌표는 한 번에 다 못 찍으므로 "얼마나 남았나"가
            이 화면을 다시 여는 이유가 된다. 다 찍었으면 굳이 말하지 않는다(빈 잔소리 금지). */}
        {coordsReady && missingCoords > 0 && (
          <p className="text-text-dim text-[11.5px]">
            위치 미지정 <span className="num font-bold">{missingCoords}</span>곳 — 좌표를 찍어 두면
            같은 아파트 앞 반대편 정류장이 말이 아니라 지도로 구분됩니다.
          </p>
        )}

        <form
          className="border-line flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-2"
          action={(fd) => submit(fd, createStop)}
        >
          <input
            name="name"
            required
            maxLength={80}
            placeholder="새 정류장 이름"
            className={cn(SHUTTLE_INPUT, "min-w-40 flex-1")}
          />
          <input
            name="memo"
            maxLength={300}
            placeholder="메모 (예: CU 건너편)"
            className={cn(SHUTTLE_INPUT, "min-w-32 flex-1")}
          />
          <Button type="submit" className={SHUTTLE_ACTION} disabled={busy}>
            추가
          </Button>
        </form>

        {/* 스크롤 상자에 테두리를 준다 — 없으면 마지막 줄이 카드 모서리에 맞닿아 "디자인이 잘린" 것처럼
            보인다(원장 2026-08-19). 경계가 보이면 잘린 게 아니라 더 있다는 뜻이 된다. */}
        <ul className="border-line flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded-xl border p-1.5">
          {stops.map((s) => {
            const uses = usageByStop.get(s.id) ?? [];
            const count = s.usedByRuns ?? uses.length;
            return editing === s.id ? (
              <li key={s.id}>
                <form
                  className="border-line flex flex-wrap items-center gap-2 rounded-xl border p-2"
                  action={(fd) => submit(fd, updateStop)}
                >
                  <input type="hidden" name="id" value={s.id} />
                  <input
                    name="name"
                    required
                    maxLength={80}
                    defaultValue={s.name}
                    className={cn(SHUTTLE_INPUT, "min-w-40 flex-1")}
                  />
                  <input
                    name="memo"
                    maxLength={300}
                    defaultValue={s.memo ?? ""}
                    placeholder="메모"
                    className={cn(SHUTTLE_INPUT, "min-w-32 flex-1")}
                  />
                  <Button type="submit" className={SHUTTLE_ACTION} disabled={busy}>
                    저장
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className={SHUTTLE_ACTION}
                    onClick={() => setEditing(null)}
                  >
                    취소
                  </Button>
                </form>
              </li>
            ) : (
              <li key={s.id} className="rounded-xl">
                <div className="hover:bg-muted flex min-h-11 flex-wrap items-center gap-2 rounded-xl px-2 py-1.5">
                  <span className="text-foreground min-w-0 flex-1 overflow-hidden text-[12.5px] font-medium text-ellipsis whitespace-nowrap">
                    {s.name}
                    {s.memo && <span className="text-text-faint font-normal"> · {s.memo}</span>}
                  </span>
                  {/* 좌표 유무 — 🔑 **미지정만 표식을 단다**. 다 찍은 정류장에까지 알약을 붙이면
                      목록이 알약 밭이 되어 정작 남은 곳이 안 보인다(주소는 아래 패널에서 본다).
                      색은 의미색 캐논: 아직 안 한 일 = caution(amber). */}
                  {coordsReady && !hasCoords(s) && (
                    <Pill color={TONE_COLOR.caution}>위치 미지정</Pill>
                  )}
                  {/* 🔴 여기가 "정렬이 떨어진다"의 대표 자리였다 — 한 줄에 수제 버튼(11px·py-1)과
                      `size="sm"` Button(h-7)이 섞여 셋의 밑선이 서로 달랐다. 셋 다 공용 `<Button>`
                      + 같은 크기 상수로 맞춘다(design-conventions "한 액션 행은 공용 Button"). */}
                  <Button
                    variant="ghost"
                    onClick={() => setOpenStop((v) => (v === s.id ? null : s.id))}
                    aria-expanded={openStop === s.id}
                    disabled={count === 0}
                    title={
                      count === 0
                        ? `${seasonLabel}에는 이 정류장을 쓰는 노선이 없습니다`
                        : "이 정류장을 쓰는 노선 보기"
                    }
                    className={cn(
                      SHUTTLE_ACTION,
                      // ⚠️ 꺼진 상태를 `text-text-faint`로 두지 않는다 — 공용 Button이 disabled에
                      //    `opacity-50`을 얹어 faint(5.7:1)가 절반으로 깎이면 사실상 안 보인다
                      //    (팔레트 v4가 대비를 올린 취지와 반대). 한 단계 진한 dim에서 출발한다.
                      count === 0
                        ? "text-text-dim"
                        : "text-text-dim hover:text-primary underline decoration-dotted underline-offset-2",
                    )}
                  >
                    노선 <span className="num">{count}</span>곳
                  </Button>
                  <Button variant="ghost" className={SHUTTLE_ACTION} onClick={() => setEditing(s.id)}>
                    수정
                  </Button>
                  {/* 🔴 0243a 미적용이면 이 버튼 자체가 없다 — 없는 기능을 약속하면 눌렀을 때
                      한글 에러만 나온다([[#95]]). */}
                  {coordsReady && (
                    <Button
                      variant="ghost"
                      className={SHUTTLE_ACTION}
                      aria-expanded={locating === s.id}
                      title="지도에서 위치를 고르거나 위경도를 직접 입력합니다"
                      onClick={() => setLocating((v) => (v === s.id ? null : s.id))}
                    >
                      위치
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className={SHUTTLE_ACTION}
                    disabled={busy || count > 0}
                    title={
                      count > 0
                        ? "노선에서 먼저 빼야 정리할 수 있습니다"
                        : "목록에서 감춥니다(지난 기록은 그대로 남습니다)"
                    }
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("id", s.id);
                      submit(fd, archiveStop);
                    }}
                  >
                    정리
                  </Button>
                </div>

                {coordsReady && locating === s.id && (
                  <StopLocationEditor
                    stop={s}
                    busy={busy}
                    onSubmit={(fd) => submit(fd, saveStopLocation)}
                    onClose={() => setLocating(null)}
                  />
                )}

                {openStop === s.id && (
                  <ul className="border-line bg-muted/40 mx-2 mb-1.5 flex flex-col gap-0.5 rounded-lg border p-1.5">
                    <li className="text-text-faint px-1 pb-0.5 text-[11.5px]">
                      {seasonLabel} 기준
                    </li>
                    {uses.map((u) => (
                      <li
                        key={u.key}
                        className="text-text-dim flex items-baseline gap-1.5 px-1 text-[11.5px]"
                      >
                        <span className="text-foreground min-w-0 flex-1 overflow-hidden font-medium text-ellipsis whitespace-nowrap">
                          {u.vehicle} · {u.run}
                        </span>
                        <span className="num text-text-faint shrink-0">{u.time ?? "—"}</span>
                        <span className="text-text-faint w-14 shrink-0 text-right">
                          {u.direction} <span className="num">{u.riders}</span>명
                        </span>
                      </li>
                    ))}
                    {uses.length === 0 && (
                      <li className="text-text-faint px-1 text-[11.5px]">
                        이 시즌에는 쓰는 노선이 없습니다
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
          {stops.length === 0 && (
            <li className="text-text-faint px-1 py-3 text-center text-[12.5px]">
              정류장이 없습니다 — 위에서 추가하세요
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
