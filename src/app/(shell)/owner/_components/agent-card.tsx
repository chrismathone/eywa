"use client";
import { useCallback,useEffect,useState,useTransition,useRef,type ReactNode } from "react";
import { EVENT_LABELS,TASK_LABELS,LOG_CODE_LABELS,UPDATE_ERROR_LABELS } from "@/features/sync-agent/protocol";
import { getAgentDashboard,issueAgentCode,issueAgentManagementCode,revokeAgentDevice,saveAgentSettings } from "@/features/sync-agent/server/actions";

type Dashboard=NonNullable<Awaited<ReturnType<typeof getAgentDashboard>>["data"]>;
const when=(value:string|null)=>value?new Date(value).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}):"아직 없음";
// `canEdit` = 연동 설정 쓰기(연동 PC 액션의 requireManager와 같은 키) — 없으면 코드 발급·연결 해제 단추를 그리지 않고 스위치를 잠근다(원장 2026-11-05).
export function AgentCard({classnoteOn,makeeduOn,legacyPC,canEdit=true}:{classnoteOn:boolean;makeeduOn:boolean;legacyPC?:ReactNode;canEdit?:boolean}) {
  const [data,setData]=useState<Dashboard|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [code,setCode]=useState<{code:string;expiresAt:string}|null>(null);
  const [managementCode,setManagementCode]=useState<{code:string;expiresAt:string}|null>(null);
  const [now,setNow]=useState(0),[pending,startTransition]=useTransition();
  const [filter,writeFilter]=useState("all"),[level,writeLevel]=useState("all");
  const [logDate,setLogDate]=useState(""),[cursors,setCursors]=useState<Array<{at:string;id:string}>>([]);
  const cursor=cursors.at(-1);
  const [loading,setLoading]=useState(true);
  const setFilter=(value:string)=>{writeFilter(value);setCursors([]);},setLevel=(value:string)=>{writeLevel(value);setCursors([]);};
  const request=useRef(0);
  const invalidate=useCallback(()=>{request.current++;},[]);
  const refresh=useCallback(async()=>{
    const current=++request.current;setLoading(true);
    try {
      const result=await getAgentDashboard({module:filter,level,...logDate?{date:logDate}:{},...cursor?{cursor}:{}});
      if(current!==request.current)return;
      setNow(Date.now());
      if(result.data){setData(result.data);setError("");}else setError(result.error??"상태를 확인하지 못했습니다.");
    }catch{if(current===request.current)setError("연동 PC 상태를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.");}
    finally{if(current===request.current)setLoading(false);}
  },[logDate,cursor,filter,level]);
  useEffect(()=>{let disposed=false;const load=async()=>{if(!disposed) await refresh();};void load();const timer=setInterval(load,20_000);return()=>{disposed=true;invalidate();clearInterval(timer);};},[refresh,invalidate]);
  const act=(fn:()=>Promise<{error?:string}>,message="")=>startTransition(async()=>{setError("");setNotice("");try{const result=await fn();if(result.error)setError(result.error);else{setNotice(message);await refresh();}}catch{setError("서버 연결을 확인해 주세요.");}});
  const settings=data?.configuration;
  const change=(key:"enabled"|"classnoteEnabled"|"makeeduEnabled"|"updatesEnabled",value:boolean)=>{
    if(!settings)return;
    act(()=>saveAgentSettings({enabled:settings.enabled,classnoteEnabled:settings.classnoteEnabled,makeeduEnabled:settings.makeeduEnabled,updatesEnabled:settings.updatesEnabled,revision:settings.revision,[key]:value}),"설정을 저장했습니다. 다음 상태 확인 때 PC에 반영됩니다.");
  };
  const device=data?.device;
  const online=device?.last_seen_at && now-Date.parse(device.last_seen_at)<90_000;
  const events=(data?.events??[]).filter(e=>(filter==="all"||e.module===filter)&&(level==="all"||e.level===level));
  const box="border-border bg-card rounded-2xl border p-5 space-y-3";
  const button="border-border rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50";
  const toggle=(key:"enabled"|"classnoteEnabled"|"makeeduEnabled"|"updatesEnabled",label:string)=><label className="flex items-center justify-between gap-4 py-2"><span>{label}</span><input aria-label={label} type="checkbox" checked={settings?.[key]??false} disabled={!canEdit||pending||!settings} onChange={e=>change(key,e.target.checked)} /></label>;
  return <div className="space-y-5" aria-label="연동 PC 관리">
    {error?<p role="alert" className="text-danger rounded-lg border p-3 text-sm">{error}</p>:null}
    {notice?<p role="status" className="text-primary text-sm">{notice}</p>:null}
    <section className={box}>
      <h2 className="font-bold">Windows 연동 앱</h2>
      <p className="text-text-dim text-sm">지점의 연동 PC 한 대에 설치하면 켜 둔 연동을 함께 실행합니다. 새 버전은 자동으로 받고, PC 앱에서 버전마다 즉시 업데이트하거나 날짜·시간을 지정합니다.</p>
      {data?.release?<a className={button+" inline-flex"} href={data.release.url} rel="noreferrer">Windows용 다운로드 · {data.release.version}</a>:<p className="text-text-dim text-sm">{data?"설치 파일을 준비 중입니다.":error?"다운로드 정보를 불러오지 못했습니다. 아래 새로고침을 눌러 주세요.":"다운로드 정보를 확인 중입니다."}</p>}
    </section>
    <section className={box}>
      <h2 className="font-bold">지점 연결 코드</h2>
      <p className="text-text-dim text-sm">앱을 처음 실행할 때 아래 코드를 입력하세요. 15분 동안 한 번 사용할 수 있으며, 재발급하면 이전 코드는 만료됩니다.</p>
      {code && Date.parse(code.expiresAt)>now?<div className="flex flex-wrap items-center gap-3"><output className="font-mono text-2xl tracking-widest" aria-label="12자리 연결 코드">{code.code.match(/.{1,4}/g)?.join(" ")}</output><button className={button} onClick={()=>{void navigator.clipboard.writeText(code.code).then(()=>setNotice("코드를 복사했습니다."),()=>setError("코드를 직접 입력해 주세요."));}}>복사</button><span className="text-text-dim text-xs">{when(code.expiresAt)}까지</span></div>:null}
      {canEdit?<button className={button} disabled={pending||!data||!!device} onClick={()=>act(async()=>{const result=await issueAgentCode();if(result.data){setCode(result.data);setNow(Date.now());}return result;})}>연결 코드 발급</button>:null}
      {device?<p className="text-text-dim text-xs">다른 PC로 교체하려면 현재 PC의 연결을 먼저 해제하세요.</p>:null}
    </section>
    <section className={box}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">담당 PC</h2><button className={button} disabled={pending} onClick={()=>void refresh()}>새로고침</button></div>
      {device?<>
        <p className="font-semibold">{device.name} <span className="text-text-dim text-sm">· {online?"온라인":"연결 확인 필요"}</span></p>
        <p className="text-text-dim text-sm">버전 {device.version??"확인 중"} · 마지막 확인 {when(device.last_seen_at)}</p>
        {canEdit?<button className={button} disabled={pending||!!device.revoke_requested_at} onClick={()=>act(async()=>{const result=await issueAgentManagementCode();if(result.data)setManagementCode(result.data);return result;})}>PC 설정 관리 코드 발급</button>:null}
        {managementCode && Date.parse(managementCode.expiresAt)>now?<p className="text-sm">앱의 설정 잠금을 여는 코드: <output className="font-mono tracking-widest">{managementCode.code.match(/.{1,4}/g)?.join(" ")}</output> · 10분 동안 한 번 사용</p>:null}
        {device.revoke_requested_at?<p role="status" className="text-sm">기존 PC의 실행 종료를 확인하고 있습니다. 완료 후 새 코드를 발급할 수 있습니다.</p>:!canEdit?null:<button className={button} disabled={pending} onClick={()=>{if(window.confirm("이 PC의 연동을 중지하고 연결을 해제할까요? 작업 중이면 완료 여부를 확인해 주세요."))act(()=>revokeAgentDevice(device.id),"연결 해제를 요청했습니다.");}}>PC 연결 해제</button>}
        {!settings?.cutoverReady?<p className="text-text-dim text-sm">앱에서 기존 워커 확인과 계정 설정을 마치면 연동을 시작할 수 있습니다.</p>:null}
      </>:<p className="text-text-dim text-sm">{data?"아직 연결된 PC가 없습니다.":error?"PC 상태를 불러오지 못했습니다.":"PC 상태를 확인 중입니다."}</p>}
      {toggle("enabled","이 PC에서 연동 실행")}
      {classnoteOn?toggle("classnoteEnabled","클래스노트 · 숙제영상 보관"):null}
      {makeeduOn?toggle("makeeduEnabled","메이크에듀"):null}
      {toggle("updatesEnabled","새 버전 다운로드·업데이트 허용")}
      <p className="text-text-dim text-xs">켜 두어도 바로 적용되지 않습니다. PC 앱에서 새 버전마다 적용 시점을 선택해야 합니다.</p>
      <p className="text-text-dim text-xs">기존 발송 시간과 자동 동기화 설정은 각 연동의 설정을 따릅니다. PC의 일시 중지 설정도 함께 적용됩니다.</p>
    </section>
    <section className={box}>
      <div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto font-bold">실행 로그</h2>
        <input className={button} type="date" aria-label="로그 날짜 (한국시간)" value={logDate||data?.logDate||""} onChange={e=>{setLogDate(e.target.value);setCursors([]);}} />
        <select className={button} aria-label="연동 기록 필터" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">전체 연동</option><option value="app">앱</option>{classnoteOn?<><option value="classnote">클래스노트</option><option value="video">영상</option></>:null}{makeeduOn?<option value="makeedu">메이크에듀</option>:null}<option value="update">업데이트</option></select>
        <select className={button} aria-label="기록 종류 필터" value={level} onChange={e=>setLevel(e.target.value)}><option value="all">전체 기록</option><option value="warning">확인 필요</option><option value="error">오류</option></select>
      </div>
      {events.length?<ol className="divide-border max-h-96 overflow-y-auto divide-y">{events.map(event=><li key={event.event_id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span className={event.level==="error"?"text-danger":""}>{event.module==="makeedu"?"메이크에듀 · ":event.module==="classnote"?"클래스노트 · ":""}{event.detail.task?`${TASK_LABELS[event.detail.task as keyof typeof TASK_LABELS]??"연동"} · `:""}{event.detail.logCode?LOG_CODE_LABELS[event.detail.logCode as keyof typeof LOG_CODE_LABELS]??"실행 기록":EVENT_LABELS[event.kind as keyof typeof EVENT_LABELS]??"실행 기록"}{event.detail.version?` · ${String(event.detail.version)}`:""}{typeof event.detail.updateError==="string"&&UPDATE_ERROR_LABELS[event.detail.updateError as keyof typeof UPDATE_ERROR_LABELS]?` · ${UPDATE_ERROR_LABELS[event.detail.updateError as keyof typeof UPDATE_ERROR_LABELS]}`:""}{typeof event.detail.count==="number"?` · ${event.detail.count}건`:""}{typeof event.detail.code==="string"&&/^(?:[A-Z0-9]{5}|unknown_operation|operation_failed|lease_lost)$/.test(event.detail.code)?` · ${event.detail.code}`:""}</span><time className="text-text-dim text-xs" dateTime={event.occurred_at??event.received_at}>{when(event.occurred_at??event.received_at)}</time></li>)}</ol>:<p className="text-text-dim text-sm">{data?"표시할 기록이 없습니다.":error?"실행 기록을 불러오지 못했습니다.":"실행 기록을 확인 중입니다."}</p>}
      <div className="flex items-center gap-2">{cursors.length?<button className={button} disabled={loading} onClick={()=>setCursors(value=>value.slice(0,-1))}>이전 로그</button>:null}{data?.hasMore&&data.nextCursor?<button className={button} disabled={loading} onClick={()=>{if(data.nextCursor){setLogDate(logDate||data.logDate);setCursors(value=>[...value,data.nextCursor!]);}}}>더 지난 로그</button>:null}<span className="text-text-dim text-xs">한국시간 · 20초마다 갱신 · 최근 30일 보관</span></div>
    </section>
    {data && !(device && settings?.cutoverReady)?legacyPC:null}
  </div>;
}
