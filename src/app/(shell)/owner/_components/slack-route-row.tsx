"use client";

import { SearchableSelect, type ComboOption } from "@/components/ui/searchable-select";
import type { SlackRoute } from "@/features/slack/format";
import { EventDropdowns, SLACK_BTN } from "./slack-event-dropdowns";

/**
 * 보낼 곳 한 줄 — [받는 곳] [분류별 알림 드롭다운 ×5] [삭제]. 1:1 줄은 고정(삭제 없음), 채널 줄은 채널을 고른다.
 * 채널 목록을 못 불러왔으면(권한·네트워크) 저장된 채널 이름만 보인다.
 */
export function SlackRouteRow({
  route,
  channelOptions,
  channelsLoading,
  onChange,
  onRemove,
}: {
  route: SlackRoute;
  channelOptions: ComboOption[];
  channelsLoading: boolean;
  onChange: (next: SlackRoute) => void;
  onRemove?: () => void;
}) {
  const setTypes = (eventTypes: string[]) => onChange({ ...route, eventTypes });

  let target;
  if (route.kind === "dm") {
    target = (
      <span className="text-foreground w-56 shrink-0 text-xs font-bold" title="그 알림을 aywa에서 받는 사람에게, 같은 이메일의 슬랙 계정으로 1:1 메시지">
        받는 사람 본인에게(1:1)
      </span>
    );
  } else {
    // 저장된 채널이 목록에 없으면(목록 로딩 전·비공개 채널 초대 해제) 이름을 옵션으로 붙여 빈 칸이 되지 않게.
    const options =
      route.channelId && !channelOptions.some((o) => o.value === route.channelId)
        ? [{ value: route.channelId, label: `#${route.channelName || route.channelId}` }, ...channelOptions]
        : channelOptions;
    target = (
      <div className="w-56 shrink-0">
        <SearchableSelect
          options={options}
          value={route.channelId}
          onValueChange={(id) => {
            const hit = channelOptions.find((o) => o.value === id);
            onChange({ ...route, channelId: id, channelName: hit ? hit.label.replace(/^#/, "") : route.channelName });
          }}
          placeholder={channelsLoading ? "채널 불러오는 중…" : "채널 선택"}
          searchPlaceholder="채널 이름 검색"
          ariaLabel="보낼 슬랙 채널"
        />
      </div>
    );
  }

  const prefix = route.kind === "dm" ? "1:1" : `#${route.channelName || "채널"}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {target}
      <EventDropdowns picked={route.eventTypes} onChange={setTypes} ariaPrefix={prefix} />
      {onRemove ? (
        <button type="button" onClick={onRemove} className={SLACK_BTN} aria-label={`${prefix} 보낼 곳 삭제`}>
          삭제
        </button>
      ) : null}
    </div>
  );
}
