"use client";

/**
 * **교시 하나의 수업계획 블록** — 한 반·한 날짜·한 교시(class_id, plan_date, slot_start)만 담는 자족 카드.
 *
 * 🔑 새로 만든 게 아니라 **재사용**이다. 주간/오늘 시트가 쓰는 것과 같은 표(`PlanTable`)를 같은 기계
 *    (`usePlanHandlers`)에 물린다. 다른 점은 **소유 범위**뿐 — 시트는 반 하나의 한 주를 한 스토어로
 *    묶지만, 자리(JJ) 출석부는 한 화면에 여러 반이 나란히 서므로 **반마다** 이 블록이 자기 스토어를 갖는다.
 *
 * 시트와 한 벌로 묶이는 계약 넷(하나라도 빠지면 "비슷하게 생긴 남"이 된다):
 *  ① **저널**(`useSheetDoc` → IndexedDB) — 창이 갑자기 닫혀도 입력이 남고 다음에 복구 후보로 뜬다.
 *     문서 키는 시트와 **같은 (테넌트, 사용자, 반, 주차)** 라 어느 화면에서 잃었든 다른 쪽에서 되살린다.
 *  ② **CAS 저장**(`useSheetSaveStore` → `api.flushPatches`) — 남이 먼저 고쳤으면 **덮지 않고** 그 칸만
 *     멈춰 "서버값/내 값"을 묻는다.
 *  ③ **presence** — scope는 시트와 **같은 `ecs:{classId}:{week}`**. 🔴 새 scope를 만들면 두 화면이 서로를
 *     못 봐서, 강사가 시트에서 열어 둔 반을 이 화면에서 모르고 덮는다.
 *     ⚠️ 비로그인 공개 화면(`/seat/jj`)에는 presence Provider가 없어 배지가 안 뜬다(읽기도 track도 안 한다) —
 *     덮어쓰기 방지는 거기서도 CAS가 그대로 한다.
 *  ④ **복사 후 CAS 재시드** — `ecs_copy_slot`은 기존 행의 빈 칸을 UPDATE하므로 서버가 돌려준 canonical
 *     행으로 다시 심어야 한다(안 심으면 방금 채워진 칸을 처음 고칠 때 충돌로 뜬다). `usePlanHandlers`가 한다.
 *
 * ⚠️ 줄 상태(`lines`)는 **마운트당 1회** 서버 값으로 초기화한다(주간 시트와 같은 계약 — 호출부가
 *    날짜·교시가 바뀔 때 `key`로 재마운트시킨다). 렌더 중 props로 되돌리면 방금 추가한 줄이 사라진다.
 */
import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { useEditPresence } from "@/features/presence/edit-presence";
import { EditingBadge } from "@/features/presence/editing-badge";
import type { CarryPatch } from "../lib/carry-marks";
import { ecsPresenceScope } from "../lib/presence-scope";
import type { PlanLineDTO } from "../server/actions";
import type { PlanWriteApi } from "./plan-api";
import { PlanTable } from "./plan-table";
import { seedPlanLines, usePlanHandlers } from "./use-plan-handlers";
import { useSheetDoc } from "./use-sheet-doc";
import { useFlushOnUnmount, useSaveIndicator, useSheetSaveStore } from "./use-sheet-saves";

/**
 * ⚠️ `memo` — 자리 출석부는 학생 칸(듣기·단어)을 칠 때마다 보드가 다시 그려진다. 안 감싸면 그 한 글자에
 *    나란한 반 3개의 계획 표(줄×6칸)가 통째로 재렌더된다. props가 안정적이어야 뜻이 있으니 호출부는
 *    `onCarried`·`flushHost`를 안정 참조로 넘긴다(seat-jj-table 참조).
 */
export const SlotPlanBlock = memo(function SlotPlanBlock({
  classId,
  api,
  tenantId,
  userId,
  weekMonday,
  planDate,
  slotStart,
  initialLines,
  skillAreas,
  canEdit,
  showExamTerm,
  onCarried,
  flushHost,
  registerFlush,
}: {
  classId: string;
  /**
   * 저장이 나갈 **문**([plan-api](./plan-api.ts)) — 로그인은 `ECS_PLAN_API`, 비로그인 공개 자리 화면은
   * `seatPlanApi(seat)`. 밑바닥(CAS·RPC)은 어느 쪽이든 같은 함수다.
   * ⚠️ 안정 참조로 넘길 것(이 컴포넌트는 `memo`다).
   */
  api: PlanWriteApi;
  tenantId: string;
  /** 저널(IndexedDB) 문서 키의 사용자 축. 공개 PIN 화면은 계정이 없어 자리 키를 쓴다. */
  userId: string;
  /** 저널·presence 문서 키의 주차(월요일) — 시트와 **같은 값**이어야 서로를 본다. */
  weekMonday: string;
  planDate: string;
  slotStart: string;
  initialLines: PlanLineDTO[];
  skillAreas: SkillAreaSetting[];
  canEdit: boolean;
  /** '내신' 구획을 그릴지 — EiE 반은 초등이라 내신이 없다(시트와 같은 판정: `english_track`). */
  showExamTerm: boolean;
  /** JJ 이어받기(듣기 레벨·누적 암기 단어수) — 호출부가 학생 칸 화면 상태에 머지한다. */
  onCarried?: (patches: CarryPatch[]) => void;
  /** 호스트가 따로 들고 있는 저장 큐(자리 출석부의 듣기·단어 디바운스)를 복사 전에 함께 비운다. */
  flushHost?: () => Promise<unknown>;
  /**
   * 이 블록의 저장 큐를 **호스트가 명시적으로 비울 수 있게** 등록한다(언마운트 때 `null`).
   *
   * 🔴 닫고 나서 **곧바로 다시 읽는** 화면(월간 뷰의 그 날짜 고치기 창)에만 필요하다 — 언마운트 flush는
   *    best-effort라 기다릴 수 없고, 안 기다리면 방금 친 글자가 서버에 닿기 전에 옛 값을 다시 그려
   *    "고쳤는데 그대로"가 된다. 그대로 머무는 화면(주간 시트·자리 출석부)은 안 넘겨도 된다.
   * ⚠️ 안정 참조로 넘길 것(이 컴포넌트는 `memo`다).
   */
  registerFlush?: (flush: (() => Promise<unknown>) | null) => void;
}) {
  // ① 저널 — 시트와 같은 문서 키(반+주차).
  const doc = useSheetDoc({ tenantId, userId, classId, week: weekMonday });
  // ⚠️ 저장 큐는 이 함수를 **마운트 때 한 번** 잡는다(useSheetSaveStore는 lazy init) — 그래서 여기 실린
  //    날짜·교시도 마운트 시점 값이다. 호출부가 날짜·교시가 바뀔 때 `key`로 재마운트시키는 계약(위 ⚠️)이
  //    깨지면 공개 PIN 문에서 **옛 교시로 게이트를 통과시키려다 거절**된다(조용히 딴 데 쓰이지는 않는다).
  const send = useCallback(
    (patches: unknown) => api.flushPatches({ classId, planDate, slotStart }, patches),
    [api, classId, planDate, slotStart],
  );
  // ② CAS 저장 큐(디바운스 + 충돌 감지).
  const store = useSheetSaveStore(send, doc.journal, canEdit);
  useFlushOnUnmount(store);
  useEffect(() => {
    if (!registerFlush) return;
    registerFlush(() => store.flush());
    return () => registerFlush(null);
  }, [registerFlush, store]);
  useEffect(() => {
    store.setCallbacks({
      onError: (m) => toast.error(m),
      onGone: () => toast.info("다른 사용자가 이 줄을 삭제했습니다 — 새로고침해 최신 상태를 확인하세요"),
    });
  }, [store]);

  const [lines, setLines] = useState(initialLines);
  // canonical 시드 — 서버가 준 값이 CAS의 expected가 된다(이게 없으면 첫 저장이 무조건 충돌).
  useEffect(() => {
    seedPlanLines(store, initialLines);
  }, [initialLines, store]);

  // ③ presence — 시트와 **같은 scope**.
  const scope = ecsPresenceScope(classId, weekMonday);
  useEditPresence(scope, canEdit);

  const applySlotLines = useCallback(
    (_planDate: string, _slotStart: string, next: PlanLineDTO[]) => setLines(next),
    [],
  );
  const applyCarried = useCallback(
    (_planDate: string, _slotStart: string, patches: CarryPatch[]) => onCarried?.(patches),
    [onCarried],
  );
  const handlers = usePlanHandlers({
    classId,
    api,
    store,
    onSlotLines: applySlotLines,
    onCarried: applyCarried,
    flushHost,
  });

  // 툴바가 없는 자리라 상태 표면(충돌·저장 중)을 여기서 그린다 — 충돌이 조용히 사라지면 입력 유실이다.
  const saveIndicator = useSaveIndicator(store);

  return (
    <section className="border-line-faint min-w-0 border-b px-2 pt-1.5 pb-2">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="editorial-eyebrow">수업계획</p>
        <EditingBadge scope={scope} />
        {/* ⚠️ "아래에서 고르세요"라고 단정하지 않는다 — 저널 복구로 되살아난 패치는 **다른 날짜·다른 교시**
            칸일 수 있고, 그 칸은 이 블록에 그려지지 않는다(오늘 면이 같은 이유로 쓰는 문구). */}
        {saveIndicator.conflicts > 0 ? (
          <span className="text-danger text-[11.5px] font-bold">
            저장 충돌 {saveIndicator.conflicts}건 — 충돌한 칸에서 서버값/내 값을 고르세요(여기 안 보이면 영어
            시트에서)
          </span>
        ) : saveIndicator.pending > 0 ? (
          <span className="text-text-dim text-[11.5px] font-semibold">저장 중…</span>
        ) : null}
      </div>

      {doc.recoverable ? (
        <div className="border-line bg-bg-soft mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed px-2 py-1 text-[11.5px]">
          <span className="text-foreground">
            저장되지 못한 입력 {doc.recoverable.mutations.length}건이 이 기기에 남아 있습니다.
          </span>
          <button
            type="button"
            className="text-primary cursor-pointer font-bold underline-offset-2 hover:underline"
            onClick={() => {
              void doc.claimRecoverable().then((muts) => {
                if (muts.length === 0) return;
                for (const m of muts) {
                  const p = m.patch;
                  store.seed(p.lineId, p.field, p.expectedValue);
                  store.edit(p.lineId, p.field, p.newValue ?? "");
                }
                toast.info(`미저장 입력 ${muts.length}건을 복구해 다시 저장합니다`);
              });
            }}
          >
            복구해서 저장
          </button>
          <button
            type="button"
            className="text-text-faint hover:text-foreground cursor-pointer"
            onClick={doc.dismissRecoverable}
          >
            무시
          </button>
        </div>
      ) : null}

      <PlanTable
        date={planDate}
        slotStart={slotStart}
        lines={lines}
        skillAreas={skillAreas}
        store={store}
        handlers={handlers}
        canEdit={canEdit}
        showExamTerm={showExamTerm}
      />
    </section>
  );
});
