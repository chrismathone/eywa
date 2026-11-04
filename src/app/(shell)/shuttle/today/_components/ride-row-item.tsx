"use client";

import { useSyncExternalStore, useTransition } from "react";
import { Pill } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { cn } from "@/lib/utils";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import {
  SHUTTLE_ACTION,
  SHUTTLE_CHIP,
  SHUTTLE_CHIP_OFF,
  SHUTTLE_INPUT,
  SHUTTLE_ROW_TEXT,
} from "@/features/shuttle/control-size";
import {
  BOARDING_STATUS_LABEL,
  DIRECTION_LABEL,
  RIDE_EXCEPTION_LABEL,
  type BoardingStatus,
  type Season,
} from "@/features/shuttle/types";
import { isInactiveDay, type RideRow } from "@/features/shuttle/roster";
import { clearBoarding, clearRideException, recordBoarding } from "@/features/shuttle/server/actions";
import { setRowChecked, useRowChecked } from "@/features/shuttle/today/check-store";
import { RiderAttendanceLine } from "./rider-attendance";
import { RiderContactLine } from "./rider-contacts";
import { StaffRideControls } from "./staff-ride-controls";

/** 그날 변경을 건 사람 표식 — 학부모(파랑 info) / 직원(앰버, 직원 수정 버튼과 같은 색)으로 갈린다(사용자 2026-10-06). */
function ExceptionByPill({ by }: { by: RideRow["exceptionBy"] }) {
  if (!by) return null;
  return by.kind === "parent" ? (
    <Pill color={TONE_COLOR.info}>학부모 변경</Pill>
  ) : (
    <span className="border-amber text-amber rounded-full border px-1.5 text-xs font-bold" title={by.name ?? undefined}>
      직원 변경{by.name ? ` · ${by.name.replace(/^.*· /, "")}` : ""}
    </span>
  );
}

/**
 * 한 줄 = 그날 한 학생의 한 회차. [탑승][미탑승] 두 버튼이 전부다(makeedu의 승차/하차/미탑승 3버튼은
 * 승·하차가 이미 배정에 정해져 있어 매일 다시 고를 이유가 없었다).
 *
 * 📱 **폰에서 달리는 차 안에서 누른다**(원장 2026-08-19) — 그래서:
 *    · 크기는 [`control-size.ts`](@/features/shuttle/control-size) 한 곳에서 온다(폰 44px·입력 16px).
 *      ⚠️ 여기서 `h-…`/`text-…`를 직접 적지 말 것 — 그렇게 갈려서 "정렬이 떨어진다"가 나왔다.
 *    · 버튼은 좌우로 **꽉 차게** 나눠 오조작을 줄인다(desktop은 auto 폭).
 *    · 이름 줄과 버튼 줄을 **세로로 분리**(좁을 때) — 한 줄에 우겨넣으면 버튼이 손톱만 해진다.
 *
 * 🔴 **되돌릴 문을 잠그지 않는다**([[#103]]) — 이미 찍은 버튼을 다시 누르면 기록이 지워져
 *    '미기록'으로 돌아간다. 오클릭한 미탑승에서 빠져나올 길이 없으면 안 된다.
 * ⚠️ 미탑승 사유는 찍은 **뒤에** 적는다(사유를 먼저 요구하면 바쁜 아침에 아무도 안 찍는다).
 */
/**
 * 줄 버튼 크기(사용자 2026-10-06 "탑승 미탑승을 좀 더 크게 · 전송은 조금 작게") —
 * 탑승·미탑승은 남는 폭을 크게 나눠 갖고(폰) 데스크톱에서도 최소 폭을 둔다. 전송은 작은 고정 크기.
 */
// size-guard-ok: 폰 36px — 사용자 2026-10-06 "탑승 미탑승 버튼을 위아래로 줄여 한 화면에 아이들이 더 나오게"(폭은 꽉 차게 그대로).
/**
 * 탑승·미탑승·하차 칩 — 좁으면 줄 폭을 나눠 갖고, 넓으면(줄 한 칸 @lg/row) 고정 폭 버튼 칸 안에서 나눠 갖는다.
 * 🔑 폭 판정은 **화면이 아니라 줄 자신의 폭**(컨테이너 쿼리, 사용자 2026-10-16 "전체 화면에서 깨져") — 창 크기·두 칸 배치와 상관없이 맞는다.
 */
// size-guard-ok: 36px 칩 — 명단 줄 안 밀도 요소(2026-10-06 "한 화면에 아이들 수")로 종전과 같은 높이다.
const BIG_CHIP = "h-9 flex-1 font-bold";

/**
 * 🔑 **찍기 ≠ 저장**(사용자 2026-10-06 "뷰 세션에만 저장해두다가 전송까지 누르면 DB에") —
 * 탑승/미탑승·취소·사유는 이 화면의 초안(draft)만 바꾸고, [전송]을 눌러야 `recordBoarding`/`clearBoarding`이 간다.
 * 초안은 탭 세션(sessionStorage)에 둔다 — 회차를 접었다 펴거나(줄이 unmount) 새로고침해도 같은 탭에선 남고,
 * 다른 기기·다른 사람에겐 안 보인다. ⚠️ 호차 머리 "N명 남음"·요약 숫자는 **DB 기준**이라 전송 전엔 안 바뀐다.
 */
type Draft = { status: BoardingStatus | null; memo: string };

const LOCKED_HINT = "전송된 기록입니다 — 바꾸려면 [취소]를 누르세요";
const NEEDS_CHECK_HINT = "하원 차에 탄 아이만 하차를 찍습니다 — 먼저 체크하세요";
const NOT_DEPARTED_HINT = "먼저 회차 [출발]을 누르세요 — 출발한 뒤에 기록합니다";

function draftKey(date: string, rowKey: string) {
  return `shuttle-draft:${date}:${rowKey}`;
}

/** 저장소를 못 쓰는 창(사생활 보호 등)에서도 이 화면 안에서는 초안이 남도록 메모리에 같이 둔다. */
const memoryDrafts = new Map<string, string>();
const DRAFT_EVENT = "shuttle-draft";

function readDraftRaw(key: string): string | null {
  try {
    return sessionStorage.getItem(key) ?? memoryDrafts.get(key) ?? null;
  } catch {
    return memoryDrafts.get(key) ?? null;
  }
}

function writeDraft(key: string, draft: Draft | null) {
  if (draft) memoryDrafts.set(key, JSON.stringify(draft));
  else memoryDrafts.delete(key);
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch {
    // 메모리 사본으로 버틴다.
  }
  window.dispatchEvent(new Event(DRAFT_EVENT));
}

function subscribeDrafts(onChange: () => void) {
  window.addEventListener(DRAFT_EVENT, onChange);
  return () => window.removeEventListener(DRAFT_EVENT, onChange);
}

/** 초안 읽기 — 서버 그림은 늘 '초안 없음'(DB 그대로)이고, 브라우저에서 세션 값으로 갈아끼운다. */
function useDraft(key: string): Draft | null {
  const raw = useSyncExternalStore(
    subscribeDrafts,
    () => readDraftRaw(key),
    () => null,
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Draft;
  } catch {
    return null;
  }
}

export function RideRowItem({
  row,
  date,
  season,
  canWrite,
  canEditException,
  ioBadge = false,
  departed = true,
  onError,
  onDone,
}: {
  row: RideRow;
  date: string;
  /** 직원 [수정] 창이 노선을 읽을 시즌. */
  season: Season;
  canWrite: boolean;
  /**
   * 일회성 변경(0229a)을 이 화면에서 조정할 수 있나 — 0229a 적용 여부 × 오늘 이후 날짜.
   * 🔴 지난 날짜는 읽기만 한다(그날의 기록이다). 화면 조건은 게이트가 아니라 서버가 다시 본다([[#77]]).
   */
  canEditException: boolean;
  /** 등·하원이 섞인 회차면 이름 옆에 [등원]/[하원]을 붙인다(사용자 2026-10-06) — 한쪽뿐이면 회차 머리가 이미 말한다. */
  ioBadge?: boolean;
  /** 이 회차가 [출발]됐나 — 아니면 탑승·미탑승·하차 칩을 잠근다(사용자 2026-10-07). 체크·안함·수정은 그대로. */
  departed?: boolean;
  onError: (msg: string | null) => void;
  onDone: () => void;
}) {
  const [busy, startTransition] = useTransition();
  /**
   * 체크 표시(사용자 2026-10-06) — DB에 저장하지 않는다. 탭 세션에 두어 회차 머리의 [출발]이 같은 값을 본다
   * (하원 아이가 다 체크됐나 — 사용자 2026-10-07, check-store.ts).
   */
  const checked = useRowChecked(date, row.key);
  /**
   * 🔒 **하원 줄은 체크된 아이만 [하차]·[전송]**(사용자 2026-10-07 "체크가 안 된 애들은 하원 차에 안 타는 애들이니 수정할
   * 필요가 없다"). [하원 안함]·[등하원 수정]은 그대로 둔다 — 체크 안 된 아이는 [하원 안함]을 눌러야 [출발]이 된다.
   * ⚠️ [취소]는 잠그지 않는다 — 이미 보낸 기록에서 빠져나올 문이다([[#103]]).
   */
  const needsCheck = row.ioKind === "out" && !checked;

  const key = draftKey(date, row.key);
  const saved: Draft = { status: row.status, memo: row.memo ?? "" };
  // 초안 = 아직 전송 안 한 찍기. null이면 DB 그대로다.
  const draft = useDraft(key);

  // 읽기 전용(권한 없음·운행 종료)이면 초안은 무시하고 DB 그대로 보인다 — 보낼 수 없는 초안을 띄우지 않는다.
  const view = canWrite ? (draft ?? saved) : saved;
  const pending = canWrite && draft !== null;
  const boarded = view.status === "boarded" || view.status === "extra";
  /**
   * 🔒 **전송된 줄은 잠근다**(사용자 2026-10-06 "전송을 보내면 취소를 누를 때까지 수정을 할 수 없게") —
   * DB에 기록이 있고 초안이 없으면 탑승/미탑승·사유를 못 바꾼다. [취소]를 누르면 초안(미기록)이 생겨 풀린다.
   */
  const locked = row.status !== null && !pending;
  /** 출발 전이라 찍을 수 없나 — 이미 기록이 있는 줄은 이 판정과 무관하게 잠금(locked)이 말한다. */
  const notDeparted = !departed;
  /** 탑승·미탑승·하차 칩을 못 누르는 이유(툴팁) — 우선순위: 전송 잠금 → 출발 전 → 하원 미체크. */
  const chipHint = locked ? LOCKED_HINT : notDeparted ? NOT_DEPARTED_HINT : needsCheck ? NEEDS_CHECK_HINT : undefined;
  const chipBlocked = locked || notDeparted || needsCheck;
  /** DB 기록이 학부모 알림으로 나갔나 — 등원 탑승·미탑승 · 하원 하차를 [전송]했을 때. */
  const boardedNotified = row.status !== null && row.notifyParent !== false;

  function setDraft(next: Draft) {
    // DB와 같아지면 초안이 아니다 — 지운다(전송할 게 없다).
    const same = next.status === saved.status && next.memo.trim() === saved.memo.trim();
    writeDraft(key, same ? null : next);
  }

  function mark(status: BoardingStatus) {
    if (locked) return;
    onError(null);
    // 같은 버튼을 다시 누르면 = 미기록으로 되돌리기(초안). 미탑승은 사유를 적는 중일 수 있어 제외.
    if (view.status === status && status !== "missed") setDraft({ ...view, status: null });
    else setDraft({ ...view, status });
  }

  /**
   * [전송] — 초안을 DB로 보낸다. 미기록으로 되돌린 초안은 기록 삭제, 나머지는 덮어쓰기.
   * 🔑 `notify=false`는 등원 줄의 [저장](사용자 2026-10-07) — 같은 저장인데 학부모 탑승 알림을 끈다(0368c).
   */
  function send(notify = true) {
    if (!draft) return;
    onError(null);
    if (draft.status === null) {
      if (!row.logId) {
        setDraft(saved);
        return;
      }
      const fd = new FormData();
      fd.set("id", row.logId);
      startTransition(async () => {
        const res = await clearBoarding(fd);
        if (res?.error) onError(res.error);
        else {
          writeDraft(key, null);
          onDone();
        }
      });
      return;
    }
    const fd = new FormData();
    fd.set("boardedOn", date);
    fd.set("studentId", row.studentId);
    fd.set("runId", row.runId);
    if (row.runStopId) fd.set("runStopId", row.runStopId);
    fd.set("ioKind", row.ioKind);
    fd.set("status", draft.status);
    if (draft.status === "missed" && draft.memo.trim()) fd.set("memo", draft.memo.trim());
    if (!notify) fd.set("notify", "0");
    startTransition(async () => {
      const res = await recordBoarding(fd);
      if (res?.error) onError(res.error);
      else {
        writeDraft(key, null);
        onDone();
      }
    });
  }

  /**
   * 일회성 변경 되돌리기 — 정기 배정 그대로로 돌아간다(등하원 기록은 건드리지 않는다).
   * ⚠️ **거는 쪽('오늘 안 탐')은 여기 없다** — 줄에 두면 바로 옆 '미탑승'과 섞여 찍힌다(다른 축).
   *    거는 건 툴바의 '일회성 변경' 한 자리에서만 한다([`ride-exception-dialog`](./ride-exception-dialog)).
   */
  function undoException() {
    if (!row.exceptionId) return;
    onError(null);
    const fd = new FormData();
    fd.set("id", row.exceptionId);
    startTransition(async () => {
      const res = await clearRideException(fd);
      if (res?.error) onError(res.error);
      else onDone();
    });
  }

  // 오늘 태울 줄이 아님 — '오늘 안 탐'(skipped) 또는 '오늘만 승하차'로 대체된 평소 줄(replaced).
  // 🔴 대체된 줄에 탑승/미탑승을 두면 같은 회차 기록을 **덮어써** 실제 탄 곳이 사라진다 — 버튼을 안 띄운다.
  const skipped = isInactiveDay(row.dayKind);
  const replaced = row.dayKind === "replaced";
  // 🔴 오늘 안 타는 줄은 **회색**이다 — 지우지 않는 대신 "할 일이 아님"이 한눈에 보여야 한다
  //    (tone 캐논의 inert = 지나간 것). 기록 색(초록·빨강)보다 이 판정이 앞선다.
  const tone = skipped
    ? "border-line bg-muted/50"
    : boarded
      ? "border-green/40 bg-green-soft"
      : view.status === "missed"
        ? "border-danger/40 bg-danger-soft"
        : "border-line";

  return (
    <li
      // 학생 찾아가기(ride-jump)가 이 표식으로 줄을 찾아 스크롤한다.
      data-ride-key={row.key}
      className={cn(
        // 📐 줄 사이를 좁힌다(사용자 2026-10-06 "한 화면에 나오는 아이들 수가 너무 적어").
        // 🔑 `@container/row` — 안쪽 배치는 **이 줄의 폭**으로 정한다(화면 폭 sm: 기준이면 두 칸 배치에서 이름이 한 글자씩 꺾였다).
        "@container/row rounded-xl border px-2 py-1.5",
        tone,
        // 전송 전 초안은 점선 테두리 — "아직 저장 안 됨"이 줄 전체로 보인다.
        pending && !skipped && "border-2 border-dashed",
      )}
    >
     <div className="flex flex-col gap-1 @lg/row:flex-row @lg/row:items-center @lg/row:gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span
          className={cn(
            // 줄의 학생 이름 — 폰·데스크톱 모두 16px(옛 데스크톱 14는 가독성 P0 아래, 디자인 v5 17단계).
            "text-sm font-bold",
            skipped ? "text-text-dim line-through" : "text-foreground",
          )}
        >
          {row.studentName || "(추가 탑승)"}
        </span>
        {/* 학교·학년(사용자 2026-10-21 "아이들 옆에 무슨학교 몇학년인지") — `schoolGradeLabel` 압축 표기("침산초4"). */}
        {row.schoolGrade && (
          <span className={cn("text-text-dim text-xs whitespace-nowrap", skipped && "line-through")}>{row.schoolGrade}</span>
        )}
        {ioBadge && (
          <Pill color={row.ioKind === "in" ? TONE_COLOR.info : TONE_COLOR.special}>{DIRECTION_LABEL[row.ioKind]}</Pill>
        )}
        {pending && !skipped && <span className="text-amber text-xs font-bold">미전송</span>}
        {/* 🔑 등원 줄에 저장된 기록이 **어느 문으로 갔나**(사용자 2026-10-07) — [전송]으로 탑승을 보냈으면 학부모 알림이 갔고,
            [저장]이면 기록만 남았다(0368c). 탑승·미탑승 모두 [전송]이면 알림이 간다(미탑승 = "탑승하지 않았습니다").
            하원 [하차]→[전송]도 알림이 간다("OO에서 내렸습니다", 사용자 2026-10-07). */}
        {row.status && !pending && !skipped && (
          <span className={cn("text-xs font-bold", boardedNotified ? "text-green" : "text-text-dim")}>
            {boardedNotified ? "학부모님에게 알람 전송했습니다" : "데이터를 저장만 했습니다"}
          </span>
        )}
        {/* 🔑 일회성 변경 표식 — tone 캐논에서 고른다: 오늘만 탑승 = special(예외·대체) ·
            오늘 안 탐 = inert(지나간 것). 사유는 **선택**이라 없으면 배지만 뜬다. */}
        {row.dayKind === "added" && (
          <>
            <Pill color={TONE_COLOR.special}>{RIDE_EXCEPTION_LABEL.add}</Pill>
            <ExceptionByPill by={row.exceptionBy} />
          </>
        )}
        {skipped && (
          <>
            <Pill color={TONE_COLOR.inert}>{replaced ? "오늘은 다른 정류장" : "오늘 안 탐"}</Pill>
            <ExceptionByPill by={row.exceptionBy} />
            {row.exceptionMemo && (
              <span className="text-text-dim text-xs">{row.exceptionMemo}</span>
            )}
          </>
        )}
        {/* 📐 정류장·시각은 **묶음 머리가 말한다**(2026-09-03 밀도 개선, today-board.groupRowsByStop)
            — 줄마다 반복하면 정작 봐야 할 이름보다 글자 덩어리가 커져 위계가 뒤집힌다.
            🔴 다만 **예정에 없던 탑승**은 남긴다 — 묶음 머리가 설명하지 못하는 예외라
               이유가 그 줄에 붙어 있어야 한다. */}
        {row.runStopId === null && (
          <span className="text-text-faint min-w-0 text-xs">예정에 없던 탑승</span>
        )}
        {/* 🔑 직원 수정 — [수정] · [등원 안함]/[하원 안함]은 **이름 줄 오른쪽**(사용자 2026-10-06 "이름이랑 같은줄").
            오늘 이후 날짜 · 0229a 적용 · 노선 칸이 있는 줄에만(예정에 없던 기록 줄은 바꿀 자리가 없다).
            🔴 이미 전송된 줄(DB에 탑승/미탑승 기록)엔 안 띄운다(사용자 2026-10-06) — 다시 바꾸려면 [취소]→[전송]으로 기록부터 지운다. */}
        {canWrite && !skipped && canEditException && row.runStopId && !row.status ? (
          // 좁으면 이름 줄 오른쪽 끝, 넓으면 이름 바로 뒤(가운데가 비어 등원·하원 줄의 버튼이 어긋나 보이지 않게).
          <span className="ml-auto @lg/row:ml-1">
            <StaffRideControls
              studentId={row.studentId}
              studentName={row.studentName}
              runId={row.runId}
              ioKind={row.ioKind}
              date={date}
              season={season}
              showSkip={!boarded}
              onError={onError}
              onDone={onDone}
            />
          </span>
        ) : null}
        {/* ✓ 하원 줄 = 그날 출석(사용자 2026-10-30 — 관리자 뷰만 데이터가 온다). 출석부를 읽기만 한다.
            이름 줄(이름 · 학교 · [등하원 수정]) **아래** 한 줄로 — 버튼 자리를 밀지 않게 맨 끝에 둔다. */}
        {row.ioKind === "out" && !skipped && <RiderAttendanceLine studentId={row.studentId} />}
      </div>

      {/* 🔴 오늘 안 타는 줄엔 탑승/미탑승을 **띄우지 않는다** — '미탑승'(예정이었는데 안 탔다)과
          '오늘 안 탐'(애초에 오늘은 안 탈 예정)은 다른 축인데 나란히 두면 반드시 섞여 찍힌다.
          대신 되돌리는 문만 남긴다(오클릭에서 빠져나올 길을 잠그지 않는다, [[#103]]). */}
      {skipped ? (
        // 되돌리기는 **줄 오른쪽 끝**(사용자 2026-10-06) — 안내 글자 바로 뒤에 붙어 있으면 자리가 애매했다.
        <span className="flex w-full shrink-0 items-center gap-1.5 @lg/row:w-auto">
          <span className="text-text-faint min-w-0 flex-1 text-xs">
            {row.status
              ? `기록: ${BOARDING_STATUS_LABEL[row.status]}`
              : replaced
                ? "오늘만 승하차 줄에서 찍습니다"
                : "오늘은 태우지 않습니다"}
          </span>
          {canWrite && canEditException && row.exceptionId && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={undoException}
              title="오늘만 승하차를 되돌려 평소대로 탑승 명단에 넣습니다"
              className={cn(SHUTTLE_ACTION, SHUTTLE_ROW_TEXT, "ml-auto shrink-0 px-2.5")}
            >
              되돌리기
            </Button>
          )}
        </span>
      ) : canWrite ? (
        // 🔑 넓으면 **고정 폭 칸**(w-72) — 등원(탑승·미탑승·저장·전송)과 하원(하차·체크·전송)의 오른쪽 끝·[전송] 자리가 줄마다 같다.
        // 📞 버튼 위 한 줄 = 학생·학부모 전화번호(사용자 2026-10-21) — 기록 권한이 있을 때만 이 칸이 선다.
        <div className="flex shrink-0 flex-col gap-1 @lg/row:w-72">
        <RiderContactLine studentId={row.studentId} />
        <div className="flex items-center gap-1.5">
          {/* 🔑 탑승·미탑승은 **상태가 남는 토글**이라 알약 칩이다(라운드 캐논: 눌러서 상태가 남으면
              칩, 동작만 하면 버튼) — 그래서 공용 `<Button>`이 아니라 `SHUTTLE_CHIP`을 쓴다.
              색은 의미색 캐논: 탄 것 = positive(초록) · 못 탄 것 = critical(빨강). */}
          {/* 🔒 전송된 줄(locked)은 눌린 색은 그대로 두고 누르지만 못하게 한다 — 무엇을 보냈는지는 보여야 한다. */}
          {/* 🔑 **하원 줄은 [하차] 하나**(사용자 2026-10-07 "탑승 미탑승 버튼을 하차 버튼 하나로") — 기록 값은 그대로
              'boarded'(하원의 boarded = 그 정류장에서 내림 · 학부모 문장 "OO에서 내렸어요"). [전송]하면 이 줄의 정류장이
              내린 곳으로 같이 저장된다(recordBoarding의 stop_label 스냅샷). 하원은 미탑승 칸이 없다. */}
          <button
            type="button"
            disabled={busy || chipBlocked}
            onClick={() => mark("boarded")}
            aria-pressed={boarded}
            title={chipHint}
            className={cn(
              SHUTTLE_CHIP,
              BIG_CHIP,
              boarded ? "bg-green text-white" : SHUTTLE_CHIP_OFF,
              chipBlocked && "disabled:opacity-60",
            )}
          >
            {row.ioKind === "out" ? "하차" : "탑승"}
          </button>
          {row.ioKind === "in" && (
            <button
              type="button"
              disabled={busy || chipBlocked}
              onClick={() => mark("missed")}
              aria-pressed={view.status === "missed"}
              title={chipHint}
              className={cn(
                SHUTTLE_CHIP,
                BIG_CHIP,
                view.status === "missed" ? "bg-danger text-white" : SHUTTLE_CHIP_OFF,
                chipBlocked && "disabled:opacity-60",
              )}
            >
              미탑승
            </button>
          )}
          {/* 🔑 체크 · 전송(사용자 2026-10-06) — 체크는 눌러서 켜고 다시 눌러 끄는 표시다.
              ⚠️ 체크는 **DB에 저장하지 않는다**(탭 세션에만 — 하원 줄은 [출발] 전에 다 체크됐는지 본다).
              🔑 [전송]이 이 줄의 탑승/미탑승 초안을 DB에 저장한다 — 보낼 게 없으면 꺼져 있다.
              🔑 **등원 줄은 체크 대신 [저장]**(사용자 2026-10-07) — [전송]과 같은 저장인데 학부모 탑승 알림을 보내지 않는다(0368c).
                 하원 줄은 체크 그대로 — 체크가 "이 아이가 하원 차에 탔나"이고, 체크된 아이만 [하차]·[전송]이 열린다. */}
          {row.ioKind === "in" ? (
            <Button
              variant="outline"
              disabled={busy || !pending}
              onClick={() => send(false)}
              title={pending ? "학부모 알림 없이 저장만 합니다" : "저장할 변경이 없습니다"}
              // size-guard-ok: [전송]과 같은 작은 고정 크기(사용자 2026-10-06 "전송은 조금 작게").
              className="h-8 shrink-0 rounded-md px-2 text-xs"
            >
              저장
            </Button>
          ) : (
            // 글자 없이 체크박스 모양(작은 네모 + ✓) — 사용자 2026-10-06 "표시 형태로 · 박스 크기 줄여".
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={checked ? "체크 풀기" : "체크"}
              title={checked ? "체크 풀기" : "체크"}
              onClick={() => setRowChecked(date, row.key, !checked)}
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md border-2",
                checked ? "border-primary bg-primary text-primary-foreground" : "border-line-strong bg-card",
              )}
            >
              {checked ? (
                <EyIcon name="check" size={16} strokeWidth={2.5} aria-hidden />
              ) : null}
            </button>
          )}
          <Button
            variant={pending ? "default" : "outline"}
            disabled={busy || !pending || needsCheck}
            onClick={() => send()}
            title={
              needsCheck
                ? NEEDS_CHECK_HINT
                : pending
                  ? row.ioKind === "in"
                    ? "저장하고 학부모에게 탑승 알림을 보냅니다"
                    : "저장하고 학부모에게 하차 알림을 보냅니다"
                  : "보낼 변경이 없습니다"
            }
            // size-guard-ok: 전송은 작은 고정 크기(사용자 2026-10-06 "전송은 조금 작게") — 탑승·미탑승이 주 버튼이다.
            className="h-8 shrink-0 rounded-md px-2 text-xs"
          >
            {busy ? "…" : "전송"}
          </Button>
          {view.status && (
            // '취소'는 상태가 안 남는 **동작**이라 공용 `<Button>`(ghost)이다. 다만 줄 안 인라인
            // 액션이라 옆 칩과 같은 크기로 맞춘다(design-conventions의 "표/리스트 행 안" 예외).
            // 🔑 취소도 초안이다 — [전송]을 눌러야 DB 기록이 지워진다.
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setDraft({ ...view, status: null })}
              title="'미기록'으로 되돌립니다(전송해야 저장)"
              // size-guard-ok: 옆 탑승·미탑승(BIG_CHIP 36px)과 같은 높이 — 줄이 다시 44px로 늘지 않게.
              className={cn(SHUTTLE_ACTION, SHUTTLE_ROW_TEXT, "text-text-faint hover:text-foreground h-9 px-2")}
            >
              취소
            </Button>
          )}
        </div>
        </div>
      ) : (
        <span className="text-text-dim shrink-0 text-xs">
          {row.status ? BOARDING_STATUS_LABEL[row.status] : "미기록"}
        </span>
      )}

      {view.status === "missed" && canWrite && !skipped && (
        <input
          value={view.memo}
          disabled={locked}
          title={locked ? LOCKED_HINT : undefined}
          onChange={(e) => setDraft({ ...view, memo: e.target.value })}
          maxLength={300}
          placeholder="미탑승 사유 (선택)"
          className={cn(SHUTTLE_INPUT, "w-full @lg/row:w-44")}
        />
      )}
      {row.status === "missed" && !canWrite && row.memo && (
        <span className="text-danger shrink-0 text-xs">{row.memo}</span>
      )}
     </div>
    </li>
  );
}
