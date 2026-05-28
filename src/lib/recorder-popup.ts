/**
 * 녹음 팝업 창 관리 유틸리티 (ijw-calander 패턴 이식).
 * 별도 창에서 녹음을 수행하여 메인 앱의 새로고침/배포/우발적 이탈 영향을 받지 않음.
 *
 * 흐름:
 * 1. 메인 창에서 openRecorderPopup() 호출 → about:blank 팝업 생성
 * 2. 팝업이 'recorder-ready' 전송 → 메인 창이 'start' 응답
 * 3. 팝업이 자동으로 녹음 시작
 * 4. 녹음 완료 시 팝업이 'recording-complete' + ArrayBuffer 전송 + 자동 다운로드(백업)
 * 5. 메인 창에서 File 객체로 변환하여 기존 업로드 플로우로 이어감
 */

const POPUP_WIDTH = 380;
const POPUP_HEIGHT = 460;

export type RecorderPopupCallbacks = {
  onComplete: (file: File, durationSeconds: number) => void;
  onError: (message: string) => void;
  onClose: () => void;
};

export type RecorderPopupOptions = {
  /** 파일명에 포함될 토큰 (메인 창이 죽었을 때 다운로드된 파일을 매칭). 영숫자만. */
  fileToken?: string;
};

/**
 * 녹음 팝업 창을 열고 녹음 완료 시 콜백 호출.
 * @returns true: 팝업 열림, false: 팝업 차단됨 (인라인 녹음으로 fallback 필요)
 */
export function openRecorderPopup(
  title: string,
  callbacks: RecorderPopupCallbacks,
  options: RecorderPopupOptions = {},
): boolean {
  const left = Math.round((screen.width - POPUP_WIDTH) / 2);
  const top = Math.round((screen.height - POPUP_HEIGHT) / 2);

  const popup = window.open(
    "about:blank",
    `recorder_${Date.now()}`,
    `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},resizable=yes`,
  );

  if (!popup) return false;

  const origin = window.location.origin;
  let completed = false;

  popup.document.write(generateRecorderHTML(title, options.fileToken));
  popup.document.close();

  const handleMessage = (event: MessageEvent) => {
    if (event.source !== popup) return;
    const { data } = event;

    switch (data.type) {
      case "recorder-ready":
        popup.postMessage({ type: "start" }, origin);
        break;

      case "recording-complete": {
        completed = true;
        const { arrayBuffer, mimeType, fileName, duration } = data;
        if (arrayBuffer && mimeType && fileName) {
          const blob = new Blob([arrayBuffer], { type: mimeType });
          const file = new File([blob], fileName, { type: mimeType });
          callbacks.onComplete(file, duration || 0);
        }
        break;
      }

      case "recording-error":
        callbacks.onError(data.message || "녹음 중 오류가 발생했습니다.");
        break;
    }
  };

  window.addEventListener("message", handleMessage);

  // 팝업 닫힘 감지
  const pollClosed = setInterval(() => {
    if (popup.closed) {
      clearInterval(pollClosed);
      window.removeEventListener("message", handleMessage);
      if (!completed) callbacks.onClose();
    }
  }, 500);

  return true;
}

function generateRecorderHTML(title: string, fileToken?: string): string {
  const escapeMap: Record<string, string> = {
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
  };
  const safeTitle = title.replace(/[<>&"]/g, (c) => escapeMap[c] || c);
  const safeToken = fileToken && /^[A-Za-z0-9_-]+$/.test(fileToken) ? fileToken : "";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fbf9f3;display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:24px;color:#1a1f1c}
.header{text-align:center;margin-bottom:24px}
.header h1{font-size:17px;font-weight:700;color:#0d1110}
.header p{font-size:12px;color:#5a635f;margin-top:4px}
.timer{font-size:48px;font-family:'JetBrains Mono','SF Mono',Consolas,monospace;font-weight:400;color:#1a1f1c;margin:12px 0;transition:color .3s}
.timer.rec{color:#d04848}
.rec-btn{width:80px;height:80px;border-radius:50%;border:3px solid #e3decf;background:#f1ede2;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;margin:12px 0;outline:none}
.rec-btn:hover{border-color:#1a5f3c;background:#e7f0ea}
.rec-btn.rec{border-color:#d04848;background:#fceeee;animation:pulse 2s infinite}
.rec-btn:disabled{opacity:.5;cursor:not-allowed;animation:none}
@keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.05);opacity:.9}}
.stop-shape{width:24px;height:24px;background:#d04848;border-radius:4px}
.status{font-size:13px;color:#5a635f;margin:6px 0;min-height:20px}
.warn{margin-top:16px;padding:8px 12px;background:#fef7e6;border:1px solid #f5d99a;border-radius:6px;font-size:12px;color:#7c5a1c;text-align:center;width:100%;max-width:320px;display:none}
.done{text-align:center;margin-top:24px;display:none}
.done .chk{width:48px;height:48px;background:#e7f0ea;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
.done p{font-size:14px;color:#1a1f1c}
.done .sub{font-size:12px;color:#9aa39d;margin-top:4px}
.err-msg{margin-top:12px;padding:8px 12px;background:#fceeee;border:1px solid #f4c5c5;border-radius:6px;font-size:13px;color:#a93232;text-align:center;width:100%;max-width:320px;display:none}
</style>
</head>
<body>
<div class="header">
  <h1>${safeTitle}</h1>
  <p>이 창을 열어둔 채 메인 화면을 자유롭게 사용하세요</p>
</div>
<div class="timer" id="tmr">00:00</div>
<button class="rec-btn" id="btn" disabled>
  <svg id="mic" width="28" height="28" viewBox="0 0 24 24" fill="#5a635f" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="#5a635f" stroke-width="2" stroke-linecap="round"/>
    <line x1="12" y1="19" x2="12" y2="22" stroke="#5a635f" stroke-width="2" stroke-linecap="round"/>
  </svg>
  <div class="stop-shape" id="stp" style="display:none"></div>
</button>
<p class="status" id="sts">준비 중...</p>
<div class="err-msg" id="errMsg"></div>
<div class="warn" id="wrn">녹음 중에는 이 창을 닫지 마세요</div>
<div class="done" id="done">
  <div class="chk">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1a5f3c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  </div>
  <p>녹음이 완료되었습니다</p>
  <p class="sub" id="doneInfo"></p>
  <p class="sub" id="doneClose">이 창은 자동으로 닫힙니다...</p>
</div>

<script>
(function(){
  var recording=false, mr=null, chunks=[], sec=0, ti=null, mime='';
  var $=function(id){return document.getElementById(id)};
  var tmr=$('tmr'),btn=$('btn'),mic=$('mic'),stp=$('stp'),sts=$('sts');
  var wrn=$('wrn'),done=$('done'),doneInfo=$('doneInfo'),doneClose=$('doneClose'),errMsg=$('errMsg');
  var origin=window.opener?window.location.origin:'*';

  function fmt(s){return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')}

  function showErr(msg){errMsg.textContent=msg;errMsg.style.display='block'}

  function start(){
    navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
      chunks=[];sec=0;
      mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':
           MediaRecorder.isTypeSupported('audio/mp4')?'audio/mp4':'audio/webm';
      mr=new MediaRecorder(stream,{mimeType:mime});
      mr.ondataavailable=function(e){if(e.data.size>0)chunks.push(e.data)};
      mr.onerror=function(){
        showErr('녹음 중 오류가 발생했습니다.');
        if(window.opener)window.opener.postMessage({type:'recording-error',message:'녹음 중 오류가 발생했습니다.'},origin);
        cleanup();
      };
      mr.onstop=function(){
        stream.getTracks().forEach(function(t){t.stop()});
        var blob=new Blob(chunks,{type:mime});
        var ext=mime.indexOf('mp4')>-1?'mp4':'webm';
        // KST(Asia/Seoul) 기준 시각 — 사용자 OS 시간대와 무관하게 일관된 파일명
        var d=new Date();
        var parts=new Intl.DateTimeFormat('en-CA',{
          timeZone:'Asia/Seoul',
          year:'numeric',month:'2-digit',day:'2-digit',
          hour:'2-digit',minute:'2-digit',second:'2-digit',
          hour12:false,hourCycle:'h23'
        }).formatToParts(d);
        var g=function(t){var p=parts.find(function(x){return x.type===t});return p?p.value:'00'};
        var ds=g('year')+'-'+g('month')+'-'+g('day')+'_'+g('hour')+'-'+g('minute')+'-'+g('second')+'_KST';
        var tok=${JSON.stringify(safeToken)};
        var fn='녹음_'+(tok?tok+'_':'')+ds+'.'+ext;

        // 이중 안전: 항상 자동 다운로드 + 메인 창에 전달
        downloadBlob(blob,fn);

        if(window.opener&&!window.opener.closed){
          blob.arrayBuffer().then(function(ab){
            try{
              window.opener.postMessage({type:'recording-complete',arrayBuffer:ab,mimeType:mime,fileName:fn,duration:sec},origin,[ab]);
            }catch(e){}
            showComplete(blob,true);
          });
        }else{
          showComplete(blob,false);
        }
      };

      function downloadBlob(b,name){
        var a=document.createElement('a');
        a.href=URL.createObjectURL(b);
        a.download=name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1000);
      }

      function showComplete(b,hasOpener){
        btn.style.display='none';sts.style.display='none';tmr.style.display='none';wrn.style.display='none';errMsg.style.display='none';
        done.style.display='block';doneInfo.textContent=fmt(sec)+' · '+(b.size/1024/1024).toFixed(1)+'MB';
        if(hasOpener){
          doneInfo.textContent+=' (백업 파일 다운로드 + 자동 분석 시작)';
          setTimeout(function(){try{window.close()}catch(e){}},2500);
        }else{
          doneInfo.textContent+=' (파일이 다운로드되었습니다)';
          doneClose.textContent='메인 화면에서 파일을 업로드해주세요';
        }
      }
      mr.start(1000);recording=true;
      btn.classList.add('rec');btn.disabled=false;mic.style.display='none';stp.style.display='block';
      sts.textContent='녹음 중 — 버튼을 눌러 정지';wrn.style.display='block';tmr.classList.add('rec');
      ti=setInterval(function(){sec++;tmr.textContent=fmt(sec)},1000);
    }).catch(function(){
      sts.textContent='마이크 접근이 거부되었습니다.';btn.disabled=false;
      if(window.opener)window.opener.postMessage({type:'recording-error',message:'마이크 접근이 거부되었습니다. 브라우저 권한을 확인해주세요.'},origin);
    });
  }

  function stop(){
    if(mr&&mr.state==='recording')mr.stop();
    recording=false;
    if(ti){clearInterval(ti);ti=null}
    btn.classList.remove('rec');sts.textContent='처리 중...';tmr.classList.remove('rec');
  }

  function cleanup(){
    if(mr&&mr.state!=='inactive'){try{mr.stream.getTracks().forEach(function(t){t.stop()});mr.stop()}catch(e){}}
    recording=false;if(ti){clearInterval(ti);ti=null}
  }

  btn.onclick=function(){if(recording)stop();else start()};

  window.addEventListener('beforeunload',function(e){if(recording)e.preventDefault()});

  var openerCheck=setInterval(function(){
    if(!recording)return;
    if(!window.opener||window.opener.closed){
      clearInterval(openerCheck);
      wrn.textContent='메인 화면이 닫혔습니다. 녹음 완료 후 파일이 자동 다운로드됩니다.';
      wrn.style.background='#fceeee';wrn.style.borderColor='#f4c5c5';wrn.style.color='#a93232';
    }
  },2000);

  window.addEventListener('message',function(ev){
    if(ev.data.type==='start'){start()}
  });

  if(window.opener){
    window.opener.postMessage({type:'recorder-ready'},origin);
    sts.textContent='녹음을 시작합니다...';
  }else{
    sts.textContent='녹음 버튼을 눌러 시작하세요';btn.disabled=false;
  }
})();
</script>
</body>
</html>`;
}
