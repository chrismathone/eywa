"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ShuttleStop } from "@/features/shuttle/types";
import { archiveStop, createStop, updateStop } from "@/features/shuttle/server/actions";

/**
 * 정류장 마스터 관리 — **여기가 정류장 이름의 유일한 자리**다.
 *
 * makeedu는 행선지가 노선마다 자유 텍스트라 같은 곳이 최대 5벌로 갈려 있었다(실측 2026-08-19:
 * "서대구 센트럴 자이 112동상가"/"112동 상가"/"센트럴자이 112동 상가"…). 그래서 여기서 이름을
 * 고치면 그 정류장을 쓰는 모든 노선이 함께 바뀐다 — 노선 화면에서는 이름을 못 고친다(일부러).
 *
 * ⚠️ 같은 아파트 앞이라도 **승차 지점이 반대편이면 다른 정류장**이다(실제로 "서희스타힐스 앞(cu건너)"과
 *    "…(칠성고맞은편)"이 그렇게 갈려 있었다) — 그 구분은 메모 칸에 적는다.
 *
 * ⚠️ `position:fixed` 오버레이를 **flex로 센터링**한다 — `-translate-x-1/2`를 쓰면 안에서 열리는
 *    dnd-kit DragOverlay 좌표가 밀린다([[#98]]).
 */
export function StopMasterDialog({
  stops,
  onClose,
  onError,
}: {
  stops: ShuttleStop[];
  onClose: () => void;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);

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
      <div className="bg-card flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 rounded-2xl p-4 shadow-xl">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-text text-[15px] font-bold">정류장 관리</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </div>
        <p className="text-text-faint text-[11.5px]">
          이름은 여기서만 고칩니다 — 고치면 이 정류장을 쓰는 모든 노선이 함께 바뀝니다. 같은 아파트
          앞이라도 승차 지점이 반대편이면 각각 만들고 메모로 구분하세요.
        </p>

        <form
          className="border-line flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-2"
          action={(fd) => submit(fd, createStop)}
        >
          <input
            name="name"
            required
            maxLength={80}
            placeholder="새 정류장 이름"
            className="border-line focus:border-primary h-11 min-w-40 flex-1 rounded-lg border px-2.5 text-base outline-none sm:h-8 sm:text-[12.5px]"
          />
          <input
            name="memo"
            maxLength={300}
            placeholder="메모 (예: CU 건너편)"
            className="border-line focus:border-primary h-11 min-w-32 flex-1 rounded-lg border px-2.5 text-base outline-none sm:h-8 sm:text-[12.5px]"
          />
          <Button type="submit" size="sm" disabled={busy}>
            추가
          </Button>
        </form>

        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {stops.map((s) =>
            editing === s.id ? (
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
                    className="border-line focus:border-primary h-11 min-w-40 flex-1 rounded-lg border px-2.5 text-base outline-none sm:h-8 sm:text-[12.5px]"
                  />
                  <input
                    name="memo"
                    maxLength={300}
                    defaultValue={s.memo ?? ""}
                    placeholder="메모"
                    className="border-line focus:border-primary h-11 min-w-32 flex-1 rounded-lg border px-2.5 text-base outline-none sm:h-8 sm:text-[12.5px]"
                  />
                  <Button type="submit" size="sm" disabled={busy}>
                    저장
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    취소
                  </Button>
                </form>
              </li>
            ) : (
              <li
                key={s.id}
                className="hover:bg-muted flex min-h-11 flex-wrap items-center gap-2 rounded-xl px-2 py-1.5"
              >
                <span className="text-text flex-1 truncate text-[12.5px] font-medium">
                  {s.name}
                  {s.memo && <span className="text-text-faint font-normal"> · {s.memo}</span>}
                </span>
                <span className="text-text-faint text-[11px]">
                  노선 <span className="num">{s.usedByRuns ?? 0}</span>곳
                </span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(s.id)}>
                  수정
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || (s.usedByRuns ?? 0) > 0}
                  title={
                    (s.usedByRuns ?? 0) > 0
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
              </li>
            ),
          )}
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
