import { formatKoreanDate } from "@/lib/date-kst";
import { loadParentRideLegsFor } from "@/features/shuttle/parent/server/parent-ride-data";
import type { ParentViewer } from "@/features/shuttle/parent/server/parent-viewer";
import { AbsentButton } from "@/features/shuttle/parent/components/absent-button";
import { ParentRideCard } from "@/features/shuttle/parent/components/parent-ride-card";
import { RideDatesProvider } from "@/features/shuttle/parent/components/ride-dates-context";
import { pickedLabel } from "./month-marks";

/**
 * 월별 달력에서 날짜를 고르고 [수정하기]를 누르면 화면 **가운데**에 뜨는 **상세** 창(사용자 2026-10-01).
 * 🔑 내용은 주간 화면의 카드와 **같은 부품**(`ParentRideCard`) — 문장·노선·[등원/하원 수정하기]·[타지 않기]가 그대로이고,
 *    저장 규칙(10분 마감 · 탄 뒤 잠금 · 짝 규칙 · 공휴일 잠금)도 같은 서버 액션이 다시 확인한다. 새 저장 경로는 없다.
 * 🔑 **여러 날**을 골랐으면 보이는 일정은 첫 날 기준이고, 바꾸면 고른 날 **모두 같은 내용**으로 바뀐다 —
 *    그 사실을 맨 위에 알린다(사용자 2026-10-01). 날짜 묶음은 `RideDatesProvider`가 버튼들에 내려준다.
 * 🔑 쉬는 날(학원 휴원일·법정공휴일)은 안내만 — "공휴일엔 학원도 쉬어요", 수정 없음.
 * 🔑 무거운 재료(노선 · 호차 전체 노선)는 이 시트가 열릴 때만 그날 것을 읽는다 — 달력 한 장엔 안 싣는다.
 * 서버 컴포넌트라 닫기는 링크(`closeHref`) — 바깥(어두운 바탕)을 눌러도 닫힌다.
 */
export async function MonthDaySheet({
  viewer,
  kid,
  dates,
  today,
  holiday,
  editable,
  closeHref,
}: {
  viewer: ParentViewer;
  kid: { id: string; name: string; schoolGrade: string };
  /** 고른 날짜(오름차순, 1개 이상) — 둘 이상이면 전부 고칠 수 있는 날이다(month-view가 걸렀다). */
  dates: string[];
  today: string;
  /** 하루만 골랐을 때 그날이 쉬는 날이면 그 이름. */
  holiday: string | null;
  editable: boolean;
  closeHref: string;
}) {
  const date = dates[0]!;
  const many = dates.length > 1;
  const live = date === today;
  const { legs, fleet } = holiday
    ? { legs: new Map(), fleet: [] }
    : await loadParentRideLegsFor(viewer, [kid.id], date, "term", live, editable);
  const dayText = live ? `오늘 · ${formatKoreanDate(date)}` : `${formatKoreanDate(date)} 일정`;
  const title = many ? `${dates.length}일 함께 수정 · ${pickedLabel(dates)}` : dayText;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={title}>
      <a href={closeHref} aria-label="닫기" className="absolute inset-0 bg-black/40" />
      {/* 시트 안 내용은 통째로 85%로 줄인다(사용자 2026-10-02 "창이 전체적으로 내용이 커") — 카드는 요일별 화면과 같은 부품이라
          글자·여백을 하나씩 줄이지 않고 배율로. 수정 창(모달)은 포털이라 이 배율을 안 탄다. */}
      <div
        className="bg-background relative max-h-[100dvh] w-full overflow-y-auto rounded-2xl px-4 pt-3 pb-4 shadow-[var(--shadow-card)]"
        style={{ zoom: 0.85 }}
      >
        <div className="flex items-center gap-2 pb-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h2>
          <a href={closeHref} className="border-line flex h-9 items-center rounded-lg border px-3 text-sm font-bold">
            닫기
          </a>
        </div>
        {holiday ? (
          <p className="bg-card text-text-dim rounded-2xl p-6 text-center text-sm break-keep">
            {holiday} · 공휴일엔 학원도 쉬어요. 셔틀이 다니지 않아 수정할 수 없어요.
          </p>
        ) : (
          <RideDatesProvider dates={dates}>
            <div className="flex flex-col gap-3">
              {many ? (
                <p className="border-danger text-danger rounded-lg border px-3 py-2 text-sm font-bold break-keep">
                  고른 {dates.length}일({pickedLabel(dates, 6)})의 등원·하원·결석을 바꾸면 모두 같은 내용으로 바뀌어요.
                  아래 일정은 {formatKoreanDate(date)} 기준이에요.
                </p>
              ) : null}
              {!editable ? <p className="text-text-dim text-xs break-keep">지난 날짜는 보기만 할 수 있어요.</p> : null}
              <ParentRideCard
                name={kid.name}
                schoolGrade={kid.schoolGrade}
                legs={legs.get(kid.id) ?? []}
                showRoute
                editing={editable}
                fleet={fleet}
                dayLabel={many ? `${dates.length}일 함께 수정 · ${dayText}` : dayText}
                onDate={date}
                today={today}
                editable={editable}
                skipButtons
              />
              {editable ? (
                <AbsentButton
                  kids={[{ id: kid.id, name: kid.name }]}
                  onDate={date}
                  className="border-danger text-danger bg-card flex h-11 w-full items-center justify-center rounded-lg border text-sm font-bold"
                />
              ) : null}
            </div>
          </RideDatesProvider>
        )}
      </div>
    </div>
  );
}
