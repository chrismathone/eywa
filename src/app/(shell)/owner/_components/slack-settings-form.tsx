"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import type { ComboOption } from "@/components/ui/searchable-select";
import { SLACK_MAX_CHANNEL_ROUTES, type SlackRoute } from "@/features/slack/format";
import {
  checkSlackMembers,
  disconnectSlack,
  listSlackChannels,
  saveSlackRoutes,
  saveSlackToken,
  sendSlackTest,
} from "@/features/slack/server/actions";
import { SLACK_BTN } from "./slack-event-dropdowns";
import { SlackRouteRow } from "./slack-route-row";

/**
 * 슬랙 연결 설정 폼 — ① 봇 토큰(바꿀 때만 입력) ② 보낼 곳(1:1 고정 한 줄 + 채널 여러 줄) × 분류별 알림 드롭다운
 * ③ 확인 메시지 · 직원 매칭 확인. 🔴 저장된 토큰은 가린 값으로만 받는다.
 */
type Result = { error?: string; message?: string };

function withDm(routes: SlackRoute[]): SlackRoute[] {
  return routes.some((r) => r.kind === "dm") ? routes : [{ kind: "dm", eventTypes: [] }, ...routes];
}

export function SlackSettingsForm({
  connected,
  maskedToken,
  teamName,
  routes: initialRoutes,
}: {
  connected: boolean;
  maskedToken: string;
  teamName: string;
  routes: SlackRoute[];
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [routes, setRoutes] = useState<SlackRoute[]>(() => withDm(initialRoutes));
  const [channels, setChannels] = useState<ComboOption[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(connected);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 채널 목록은 카드가 보인 뒤에 불러온다 — 외부 API를 첫 페인트에서 기다리지 않게([[#76]]).
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    listSlackChannels().then((r) => {
      if (!alive) return;
      setChannelsLoading(false);
      if (r.error) setErr(r.error);
      setChannels((r.channels ?? []).map((c) => ({ value: c.id, label: `#${c.name}`, hint: c.isPrivate ? "비공개" : undefined })));
    });
    return () => {
      alive = false;
    };
  }, [connected]);

  function run(action: () => Promise<Result>, after?: () => void) {
    if (pending) return;
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await action();
      if (res.message) setMsg(res.message);
      if (res.error) setErr(res.error);
      if (!res.error) {
        after?.();
        router.refresh();
      }
    });
  }

  const saveToken = () => run(() => saveSlackToken(token), () => setToken(""));
  const saveRoutes = () => {
    if (routes.some((r) => r.kind === "channel" && !r.channelId)) {
      setErr("채널을 고르지 않은 줄이 있습니다 — 채널을 고르거나 그 줄을 삭제해 주세요");
      return;
    }
    run(() => saveSlackRoutes(routes));
  };
  const disconnect = () => {
    if (!window.confirm("슬랙 연결을 해제할까요? 알림이 더 이상 슬랙으로 가지 않습니다.")) return;
    run(() => disconnectSlack(), () => setToken(""));
  };
  const checkMembers = () =>
    run(async () => {
      const r = await checkSlackMembers();
      if (r.error) return { error: r.error };
      const missing = r.missing ?? [];
      return missing.length === 0
        ? { message: `직원 ${r.checked ?? 0}명 모두 슬랙에서 찾았습니다` }
        : { message: `슬랙에서 못 찾은 직원 ${missing.length}명(1:1 알림을 못 받습니다): ${missing.join(", ")}` };
    });
  const channelCount = routes.filter((r) => r.kind === "channel").length;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="slack-bot-token" className="text-foreground block text-xs font-bold">
          봇 토큰
          <span className="text-text-dim ml-2 font-normal">
            {connected ? `연결됨 · ${teamName ? `${teamName} · ` : ""}${maskedToken}` : "슬랙 앱 → OAuth & Permissions → Bot User OAuth Token"}
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="slack-bot-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={connected ? "바꿀 때만 새 토큰을 붙여 넣으세요" : "xoxb-…"}
            spellCheck={false}
            autoComplete="off"
            className="border-line bg-bg-soft focus:border-primary min-w-64 flex-1 rounded-md border px-2.5 py-1.5 font-mono text-xs outline-none"
          />
          <button type="button" onClick={saveToken} disabled={pending || !token.trim()} className={SLACK_BTN}>
            토큰 저장
          </button>
          {connected ? (
            <button type="button" onClick={disconnect} disabled={pending} className={SLACK_BTN}>
              연결 해제
            </button>
          ) : null}
        </div>
      </div>

      {connected ? (
        <div className="space-y-2">
          <p className="text-foreground text-xs font-bold">보낼 곳과 알림</p>
          {routes.map((r, i) => (
            <SlackRouteRow
              key={r.kind === "dm" ? "dm" : `ch-${i}`}
              route={r}
              channelOptions={channels}
              channelsLoading={channelsLoading}
              onChange={(next) => setRoutes((prev) => prev.map((x, j) => (j === i ? next : x)))}
              onRemove={r.kind === "channel" ? () => setRoutes((prev) => prev.filter((_, j) => j !== i)) : undefined}
            />
          ))}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setRoutes((prev) => [...prev, { kind: "channel", channelId: "", channelName: "", eventTypes: [] }])}
              disabled={pending || channelCount >= SLACK_MAX_CHANNEL_ROUTES}
              className={SLACK_BTN}
            >
              채널 추가
            </button>
            <button type="button" onClick={saveRoutes} disabled={pending} className={SLACK_BTN.replace("text-text-dim", "text-foreground")}>
              {pending ? <Loader2 className="size-3 animate-spin" /> : null}
              저장
            </button>
            <button type="button" onClick={() => run(() => sendSlackTest())} disabled={pending} className={SLACK_BTN}>
              확인 메시지 보내기
            </button>
            <button type="button" onClick={checkMembers} disabled={pending} className={SLACK_BTN}>
              직원 매칭 확인
            </button>
          </div>
        </div>
      ) : null}

      {msg ? <p className="text-primary text-xs">{msg}</p> : null}
      {err ? <p className="text-danger text-xs">{err}</p> : null}
    </div>
  );
}
