"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { cn } from "@/lib/utils";
import {
  SHUTTLE_ACTION,
  SHUTTLE_CHIP,
  SHUTTLE_CHIP_ADD,
  SHUTTLE_ICON_BTN,
  SHUTTLE_INPUT,
  SHUTTLE_ROW,
  SHUTTLE_ROW_TEXT,
} from "@/features/shuttle/control-size";
import { RUN_STOP_KIND_LABEL, runTitle, type ShuttleRun, type ShuttleStop } from "@/features/shuttle/types";
import type { AssignableStudent } from "@/features/shuttle/server/students";
import { addRunStop, removeRunStop, updateRunStopTime } from "@/features/shuttle/server/actions";
import { RiderChip } from "./rider-chip";

/**
 * 가운데 열 — 고른 회차의 노선. 위에서 아래로 학원 출발 → 정류장들 → 학원 도착.
 *
 * 각 칸은 **드롭 대상**(학생·배정 칩이 여기 떨어진다)이면서 **드래그 손잡이**를 가진다(순서 변경).
 * 📱 폰에서는 탭이 갈려 드래그로 학생을 데려올 수 없으므로 칸마다 **'+ 학생'** 버튼을 둔다 —
 *    이게 좁은 화면의 기본 배정 수단이고, 드래그는 PC의 빠른 길이다.
 * ⚠️ 시각 입력·삭제 버튼은 드래그 임계값(5px) 덕에 클릭이 살아 있다 — 손잡이를 따로 두는 이유가
 *    이거다(칸 전체를 잡게 하면 입력을 못 누른다, [[#97]] 팬 영역의 클릭 유실과 같은 결).
 */
export function StopColumn({
  run,
  stops,
  students,
  canWrite,
  pending,
  onError,
  onAssign,
}: {
  run: ShuttleRun | null;
  stops: ShuttleStop[];
  students: AssignableStudent[];
  canWrite: boolean;
  pending: boolean;
  onError: (msg: string | null) => void;
  onAssign: (runStopId: string, studentId: string) => void;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  function submit(fd: FormData, action: (f: FormData) => Promise<{ error?: string; notice?: string } | undefined>) {
    onError(null);
    startTransition(async () => {
      const res = await action(fd);
      if (res?.error) onError(res.error);
      else router.refresh();
    });
  }

  if (!run) {
    return (
      <div className="border-line text-text-dim flex items-center justify-center rounded-2xl border border-dashed p-8 text-sm">
        회차를 고르세요
      </div>
    );
  }

  // 이미 이 회차에 있는 정류장은 추가 목록에서 뺀다(넣어봐야 유니크 제약에 걸린다).
  const used = new Set(run.stops.map((s) => s.stopId).filter(Boolean));
  const addable = stops.filter((s) => !used.has(s.id));

  return (
    // ⚠️ `px-1 py-0.5` — 카드 테두리는 실제 border가 아니라 `--shadow-card`의 1px 링(팔레트 v4)이라
    //    **박스 밖 1px**에 그려진다. 그런데 `overflow-y-auto`는 CSS상 가로도 함께 잘라내므로(한 축만
    //    visible일 수 없다) 링의 좌·우가 통째로 깎여 "테두리가 짤려 보인다"(원장 2026-08-19 제보).
    //    안쪽 여백을 조금 주면 링이 잘릴 자리가 생긴다. 컨테이너 안 요소는 다 같이 밀리므로 줄맞춤은 그대로.
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-1 py-0.5">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-foreground text-base font-bold">{runTitle(run)}</h2>
        {canWrite && (
          <Button variant="outline" className={SHUTTLE_ACTION} onClick={() => setAdding((v) => !v)}>
            + 정류장
          </Button>
        )}
      </div>
      {canWrite && (
        // 요일 편집이 칩 안에 접혀 있어 처음 보면 못 찾는다(원장 2026-08-19 *"요일 어디서?"*) —
        // 어디를 눌러야 하는지 한 줄로 적어 둔다.
        <p className="text-text-faint px-1 text-xs">
          학생을 끌어다 놓으면 <b className="font-bold">평일</b>로 들어갑니다 — 칩의 요일 글자를
          누르면 요일을 바꿉니다.
        </p>
      )}

      {adding && canWrite && (
        <div className="bg-card flex max-h-56 flex-col gap-1 overflow-y-auto rounded-2xl p-2 shadow-[var(--shadow-card)]">
          {addable.length === 0 ? (
            <p className="text-text-faint px-1 py-2 text-xs">
              추가할 정류장이 없습니다 — 헤더의 &lsquo;정류장 관리&rsquo;에서 먼저 만드세요.
            </p>
          ) : (
            addable.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={busy || pending}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("runId", run.id);
                  fd.set("stopId", s.id);
                  submit(fd, addRunStop);
                  setAdding(false);
                }}
                className={cn("hover:bg-muted cursor-pointer rounded-lg px-2 py-1.5 text-left", SHUTTLE_ROW, SHUTTLE_ROW_TEXT)}
              >
                {s.name}
                {s.memo && <span className="text-text-faint"> · {s.memo}</span>}
              </button>
            ))
          )}
        </div>
      )}

      {run.stops.map((stop) => (
        <StopCard
          key={stop.id}
          stop={stop}
          students={students}
          canWrite={canWrite}
          busy={busy || pending}
          onTime={(v) => {
            const fd = new FormData();
            fd.set("id", stop.id);
            fd.set("atTime", v);
            submit(fd, updateRunStopTime);
          }}
          onRemove={() => {
            const fd = new FormData();
            fd.set("id", stop.id);
            submit(fd, removeRunStop);
          }}
          onAssign={(studentId) => onAssign(stop.id, studentId)}
          onError={onError}
        />
      ))}
    </div>
  );
}

function StopCard({
  stop,
  students,
  canWrite,
  busy,
  onTime,
  onRemove,
  onAssign,
  onError,
}: {
  stop: ShuttleRun["stops"][number];
  students: AssignableStudent[];
  canWrite: boolean;
  busy: boolean;
  onTime: (v: string) => void;
  onRemove: () => void;
  onAssign: (studentId: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const isCampus = stop.kind !== "stop";

  const { setNodeRef, isOver } = useDroppable({
    id: `stop:${stop.id}`,
    data: { type: "stop", runStopId: stop.id },
    disabled: isCampus, // 학원 출발/도착 칸엔 학생을 배정하지 않는다(서버도 거절)
  });
  const {
    attributes,
    listeners,
    setNodeRef: setHandleRef,
    isDragging,
  } = useDraggable({
    id: `stopRow:${stop.id}`,
    data: { type: "stopRow", runStopId: stop.id, label: stop.stopName },
    disabled: !canWrite,
  });

  const already = useMemo(() => new Set(stop.riders.map((r) => r.studentId)), [stop.riders]);
  const candidates = useMemo(() => {
    const key = q.replace(/\s+/g, "").toLowerCase();
    // 🔑 **검색해야 나온다** — 재원생 전원(실측 336명)을 늘 세워두면 찾는 데 방해만 된다
    //    (오른쪽 학생 풀과 같은 규약, 원장 2026-08-19).
    if (!key) return [];
    return students
      .filter((s) => !already.has(s.id))
      .filter((s) => s.searchKey.includes(key))
      .slice(0, 40); // 목록은 검색으로 좁힌다 — 상한은 '더 있음'을 아래에 표기
  }, [students, already, q]);

  return (
    <section
      ref={setNodeRef}
      className={`bg-card rounded-2xl p-2.5 shadow-[var(--shadow-card)] transition-colors ${
        isOver ? "ring-primary ring-2" : ""
      } ${isDragging ? "opacity-50" : ""} ${isCampus ? "bg-muted/40" : ""}`}
    >
      <div className="flex items-center gap-2">
        {canWrite && (
          <button
            ref={setHandleRef}
            {...listeners}
            {...attributes}
            type="button"
            aria-label="순서 변경"
            // touch-none: 손잡이 위에서는 브라우저 스크롤 제스처를 끄고 드래그로 넘긴다.
            className={cn(SHUTTLE_ICON_BTN, "text-text-faint hover:text-foreground cursor-grab touch-none active:cursor-grabbing")}
          >
            <EyIcon name="grip" className="size-4" />
          </button>
        )}
        <span className={`min-w-0 flex-1 truncate text-sm ${isCampus ? "text-text-dim font-medium" : "text-foreground font-bold"}`}>
          {isCampus ? RUN_STOP_KIND_LABEL[stop.kind] : stop.stopName}
          {stop.stopMemo && <span className="text-text-faint text-xs"> · {stop.stopMemo}</span>}
        </span>
        {/* 배정이 0명이면 '+ 학생'을 **머리줄의 빈 자리**에 둔다 — 아래에 따로 줄을 만들면 카드마다
            빈 줄이 하나씩 생겨 세로가 낭비된다(원장 2026-08-19 *"공간낭비 없도록"*). */}
        {canWrite && !isCampus && stop.riders.length === 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setPicking((v) => !v)}
            className={cn(SHUTTLE_CHIP, SHUTTLE_CHIP_ADD)}
          >
            + 학생
          </button>
        )}
        <input
          type="time"
          defaultValue={stop.atTime ?? ""}
          disabled={!canWrite || busy}
          onBlur={(e) => {
            if ((e.currentTarget.value || "") !== (stop.atTime ?? "")) onTime(e.currentTarget.value);
          }}
          aria-label="도착 시각"
          // ⚠️ 폭은 짐작하지 말 것 — 한국어 로캘의 `type="time"`은 "오후 03:45" + 시계 아이콘이라
          //    실측 폭이 16px 글자에서 127px, 12px 글자에서 105px다(전엔 104/92라 "오후 03:4"로 잘렸다).
          //    2026-09-08 v5 글자 기준 실측: SHUTTLE_INPUT이 데스크톱 `sm:text-sm`=16px·폰 `text-base`=18px라
          //    데스크톱은 위 실측값 127px이 그대로 필요 폭(옛 118px은 12.5px 기준 109px에서 올린 값이라 9px 부족),
          //    폰은 텍스트분 비례(오후 03:45 ≈89 + 아이콘·간격 ≈34 + px-1.5 12 + border 2) ≈137px라 132px이 5px 부족했다.
          //    → 144px/132px(각 ≈7px·5px 여유). 경계에 딱 맞추면 로캘·폰트가 조금만 달라도 다시 잘린다.
          className={cn(SHUTTLE_INPUT, "num w-[144px] shrink-0 px-1.5 sm:w-[132px]")}
        />
        {canWrite && !isCampus ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            aria-label="이 정류장을 노선에서 빼기"
            className={cn(SHUTTLE_ICON_BTN, "text-text-faint hover:text-danger cursor-pointer")}
          >
            <EyIcon name="trash" className="size-3.5" />
          </button>
        ) : (
          // 학원 출발/도착 줄엔 삭제 버튼이 없다 — 자리를 비워 두면 그 줄만 시각이 오른쪽으로 튀어
          // 시각 칸이 줄마다 어긋난다. 같은 크기의 빈 칸으로 열을 맞춘다(원장 2026-08-19 *"정렬 깔끔하게"*).
          // ⚠️ 빈 칸은 **손잡이·삭제와 같은 상수**여야 한다 — 여기만 크기를 손으로 적으면 다음에
          //    아이콘 크기를 고칠 때 이 줄만 뒤처져 시각 칸이 다시 어긋난다.
          canWrite && <span aria-hidden className={SHUTTLE_ICON_BTN} />
        )}
      </div>

      {!isCampus && stop.riders.length > 0 && (
        // 🔑 균일 폭 격자 — 칩이 내용 길이대로 늘어나면 요일·× 라벨이 칩마다 다른 x에 서서 눈이
        //    매번 다시 찾는다(원장 2026-08-19: *"라벨이 어딜 가나 같은 위치였으면"*). 칸 폭을 고정하면
        //    이름은 왼쪽, 요일·×는 오른쪽 같은 자리에 줄맞춰 선다.
        <div className="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-start gap-1">
          {stop.riders.map((r) => (
            <RiderChip key={r.id} rider={r} canWrite={canWrite} onError={onError} />
          ))}
          {canWrite && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setPicking((v) => !v)}
              // ⚠️ 격자 칸을 꽉 채우지 않는다(`justify-self-start`) — 점선 테두리를 칩 폭만큼 늘리면
              //    화면에 긴 파선이 여러 줄 생겨 "테두리가 깨져 보인다"(원장 2026-08-19 제보).
              className={cn(SHUTTLE_CHIP, SHUTTLE_CHIP_ADD, "justify-self-start")}
            >
              + 학생
            </button>
          )}
        </div>
      )}
      {!isCampus && stop.riders.length === 0 && !canWrite && (
        <p className="text-text-faint mt-1.5 text-xs">배정된 학생이 없습니다</p>
      )}

      {picking && canWrite && !isCampus && (
        <div className="border-line mt-2 flex flex-col gap-1 rounded-xl border p-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름·학교 검색"
            className={SHUTTLE_INPUT}
          />
          <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {candidates.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  onAssign(s.id);
                  setPicking(false);
                  setQ("");
                }}
                className={cn("hover:bg-muted flex cursor-pointer items-center gap-1.5 rounded-lg px-2 text-left", SHUTTLE_ROW, SHUTTLE_ROW_TEXT)}
              >
                <span className="text-foreground font-medium">{s.name}</span>
                {s.schoolGrade && <span className="text-text-faint text-xs">{s.schoolGrade}</span>}
              </button>
            ))}
            {candidates.length === 0 && (
              <span className="text-text-faint px-1 py-2 text-xs">
                {q.trim() ? "찾는 학생이 없습니다" : "이름이나 학교를 입력하세요"}
              </span>
            )}
            {candidates.length === 40 && (
              <span className="text-text-faint px-1 py-1 text-xs">
                40명까지만 표시됩니다 — 이름을 더 입력해 좁히세요
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
