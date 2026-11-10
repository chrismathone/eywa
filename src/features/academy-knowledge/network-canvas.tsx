"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { entities } from "./catalog";
import { networkPositions } from "./network-model";
import type { VisualNode, VisualEdge } from "./studio-model";
import s from "./studio.module.css";

const palette=["#363c41","#fdb811","#7a8388","#a3abae","#c6ccce","#8a6100"];
type Display={selected?:string;colored:boolean;labels:boolean};
type Engine={draw:()=>void;fit:()=>void;zoom:(factor:number)=>void;center:()=>void};

export function GraphCanvas({nodes,edges,selected,onSelect,summary=false}:{nodes:VisualNode[];edges:VisualEdge[];selected?:string;onSelect:(id:string)=>void;summary?:boolean}) {
  const positions=useMemo(()=>networkPositions(nodes,edges),[nodes,edges]);
  const canvas=useRef<HTMLCanvasElement>(null),engine=useRef<Engine|null>(null),select=useRef(onSelect);
  const [colored,setColored]=useState(false),[labels,setLabels]=useState(false),[expanded,setExpanded]=useState(false);
  const [zoom,setZoom]=useState(100),[hover,setHover]=useState<VisualNode|null>(null);
  const [expandedBounds,setExpandedBounds]=useState<{left:number;top:number;right:number;bottom:number}>();
  const display=useRef<Display>({selected,colored,labels});
  useEffect(()=>{select.current=onSelect;},[onSelect]);
  useEffect(()=>{display.current={selected,colored,labels};engine.current?.draw();},[selected,colored,labels]);
  useEffect(()=>{if(!expanded)return;const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setExpanded(false);};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[expanded]);
  useEffect(()=>{
    if(!expanded)return;
    // Keep the enlarged canvas inside the app's content area, including embedded tabs.
    let main:HTMLElement|null=null;
    for(let p=canvas.current?.parentElement;p;p=p.parentElement){if(p.tagName==="MAIN")main=p;}
    const measure=()=>{const r=main?.getBoundingClientRect();setExpandedBounds({left:Math.max(12,(r?.left??0)+12),top:Math.max(12,(r?.top??0)+12),right:Math.max(12,window.innerWidth-(r?.right??window.innerWidth)+12),bottom:Math.max(12,window.innerHeight-(r?.bottom??window.innerHeight)+12)});};
    measure();const observer=new ResizeObserver(measure);if(main)observer.observe(main);window.addEventListener("resize",measure);
    return()=>{observer.disconnect();window.removeEventListener("resize",measure);};
  },[expanded]);
  useEffect(()=>{
    const el=canvas.current;if(!el)return;
    const ctx=el.getContext("2d");if(!ctx)return;
    const points=Object.fromEntries(Object.entries(positions).map(([id,p])=>[id,{...p}]));
    const adjacent=new Map(nodes.map(n=>[n.id,new Set<string>()]));
    edges.forEach(e=>{adjacent.get(e.from)?.add(e.to);adjacent.get(e.to)?.add(e.from);});
    const hubs=[...nodes].sort((a,b)=>b.count-a.count).slice(0,8);
    let width=1,height=1,dpr=1,view={x:0,y:0,k:1},frame=0,hoverId="";
    let drag:{id?:string;x:number;y:number;startX:number;startY:number;moved:boolean}|null=null;
    const radius=(n:VisualNode)=>summary?5+Math.min(12,Math.log2(n.count+1)*1.4):1.7+Math.min(8,Math.log2(n.count+1)*.6);
    const screen=(id:string)=>({x:points[id].x*view.k+view.x,y:points[id].y*view.k+view.y});
    function paint(){
      frame=0;if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle="#ffffff";ctx.fillRect(0,0,width,height);
      const active=hoverId||display.current.selected,neighbors=active?adjacent.get(active):undefined;
      for(const e of edges){
        if(!points[e.from]||!points[e.to])continue;
        const a=screen(e.from),b=screen(e.to),highlight=active&&(e.from===active||e.to===active);
        const strength=Math.min(1,Math.log2(e.count+1)/7);
        ctx.globalAlpha=active ? (highlight ? .8 : .045) : .12+strength*.48;
        ctx.strokeStyle=e.unloaded?"#7a8388":e.pending?"#c28700":e.missing?"#b44832":highlight?"#c28700":"#a3abae";
        ctx.lineWidth=highlight?1.1:Math.min(3,.38+strength*1.9);
        ctx.setLineDash(e.pending||e.missing?[3,4]:[]);
        ctx.beginPath();if(e.from===e.to)ctx.arc(a.x,a.y-9,9,0,Math.PI*2);else{ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}ctx.stroke();
      }
      ctx.setLineDash([]);
      for(const n of nodes){
        const p=screen(n.id),r=Math.max(summary?3:1.2,radius(n)*Math.sqrt(view.k));
        if(p.x < -25||p.y < -25||p.x > width+25||p.y > height+25)continue;
        const chosen=n.id===active,near=neighbors?.has(n.id),color=palette[Math.max(0,entities.findIndex(e=>e[0]===n.type))%palette.length];
        ctx.globalAlpha=active && !chosen && !near ? .19 : 1;
        ctx.fillStyle=chosen?"#23282c":display.current.colored?color:near?"#485055":"#7d8389";
        ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);
        if(n.missing){ctx.strokeStyle=n.unloaded?"#7a8388":"#b44832";ctx.lineWidth=1.2;ctx.setLineDash([2,3]);ctx.stroke();ctx.setLineDash([]);}else ctx.fill();
        if(chosen||n.pending||n.incomplete){ctx.strokeStyle=chosen?"#23282c":"#c28700";ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,r+3,0,Math.PI*2);ctx.stroke();}
        if(n.count===0&&!n.missing){ctx.strokeStyle="#a9afb6";ctx.lineWidth=.6;ctx.beginPath();ctx.arc(p.x,p.y,r+2,0,Math.PI*2);ctx.stroke();}
      }
      ctx.globalAlpha=1;
      const candidates=[...nodes.filter(n=>n.id===active),...nodes.filter(n=>neighbors?.has(n.id)),...(display.current.labels||view.k>2.1||summary?nodes:hubs)];
      const drawn=new Set<string>(),boxes:{x:number;y:number;w:number;h:number}[]=[];
      for(const n of candidates){
        if(drawn.has(n.id))continue;drawn.add(n.id);const chosen=n.id===active,near=neighbors?.has(n.id);
        if(active&&!chosen&&!near&&!display.current.labels)continue;
        const p=screen(n.id);if(p.x<5||p.x>width-5||p.y<5||p.y>height-25)continue;
        const text=n.label.length>24?n.label.slice(0,24)+"…":n.label;
        ctx.font=(chosen?"600 13":"400 11")+"px system-ui, sans-serif";
        const w=ctx.measureText(text).width+8,y=p.y+Math.max(3,radius(n)*Math.sqrt(view.k))+7,x=p.x-w/2;
        if(!chosen&&boxes.some(b=>x<b.x+b.w&&x+w>b.x&&y<b.y+b.h&&y+17>b.y))continue;
        boxes.push({x,y,w,h:17});ctx.fillStyle="rgba(255,255,255,.88)";ctx.fillRect(x,y,w,17);
        ctx.fillStyle="#23282c";ctx.textAlign="center";ctx.textBaseline="top";ctx.fillText(text,p.x,y+2);
        if(boxes.length>250)break;
      }
      if(!nodes.length){ctx.fillStyle="#23282c";ctx.font="14px system-ui";ctx.textAlign="center";ctx.fillText("현재 보기에서 표시할 기록이 없습니다",width/2,height/2);}
    }
    const draw=()=>{if(!frame)frame=requestAnimationFrame(paint);};
    const report=()=>{setZoom(Math.round(view.k*100));draw();};
    function fit(){
      const values=Object.values(points);if(!values.length){view={x:width/2,y:height/2,k:1};report();return;}
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const p of values){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
      const k=Math.max(.05,Math.min(2.4,(width-110)/Math.max(100,maxX-minX),(height-100)/Math.max(100,maxY-minY)));
      view={k,x:width/2-(minX+maxX)/2*k,y:height/2-(minY+maxY)/2*k};report();
    }
    function zoomAt(factor:number,x=width/2,y=height/2){const next=Math.max(.05,Math.min(12,view.k*factor)),ratio=next/view.k;view={k:next,x:x-(x-view.x)*ratio,y:y-(y-view.y)*ratio};report();}
    function hit(x:number,y:number){let best:VisualNode|undefined,distance=Infinity;for(const n of nodes){const p=screen(n.id),d=Math.hypot(p.x-x,p.y-y);if(d<Math.max(6,radius(n)*Math.sqrt(view.k)+3)&&d<distance){best=n;distance=d;}}return best;}
    const local=(e:{clientX:number;clientY:number})=>{const r=el!.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
    function down(e:PointerEvent){if(e.button!==0)return;const p=local(e),n=hit(p.x,p.y);drag={id:n?.id,...p,startX:p.x,startY:p.y,moved:false};el!.setPointerCapture(e.pointerId);}
    function move(e:PointerEvent){
      const p=local(e);
      if(drag){const dx=p.x-drag.x,dy=p.y-drag.y;drag.moved ||= Math.hypot(p.x-drag.startX,p.y-drag.startY)>4;
        if(drag.moved){if(drag.id){points[drag.id].x+=dx/view.k;points[drag.id].y+=dy/view.k;}else{view.x+=dx;view.y+=dy;}draw();}drag.x=p.x;drag.y=p.y;return;}
      const n=hit(p.x,p.y);if((n?.id??"")!==hoverId){hoverId=n?.id??"";setHover(n??null);el!.style.cursor=n?"pointer":"grab";draw();}
    }
    function up(e:PointerEvent){const previous=drag;drag=null;if(el!.hasPointerCapture(e.pointerId))el!.releasePointerCapture(e.pointerId);if(previous?.id&&!previous.moved)select.current(previous.id);}
    function cancel(){drag=null;}
    function leave(){if(drag)return;hoverId="";setHover(null);draw();}
    function wheel(e:WheelEvent){e.preventDefault();const p=local(e);zoomAt(Math.exp(-Math.max(-150,Math.min(150,e.deltaY))*.002),p.x,p.y);}
    function key(e:KeyboardEvent){if(["+","=","-","0","ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key))e.preventDefault();if(e.key==="+"||e.key==="=")zoomAt(1.25);if(e.key==="-")zoomAt(.8);if(e.key==="0")fit();if(e.key.startsWith("Arrow")){view.x+=e.key==="ArrowLeft"?40:e.key==="ArrowRight"?-40:0;view.y+=e.key==="ArrowUp"?40:e.key==="ArrowDown"?-40:0;draw();}}
    function resize(){const r=el!.getBoundingClientRect();width=Math.max(120,r.width);height=Math.max(120,r.height);dpr=Math.min(2,window.devicePixelRatio||1);el!.width=Math.round(width*dpr);el!.height=Math.round(height*dpr);fit();}
    engine.current={draw,fit,zoom:zoomAt,center:()=>{const p=points[display.current.selected??""];if(!p)return;view.k=Math.max(view.k,2);view.x=width/2-p.x*view.k;view.y=height/2-p.y*view.k;report();}};
    const observer=new ResizeObserver(resize);observer.observe(el);
    el.addEventListener("pointerdown",down);el.addEventListener("pointermove",move);el.addEventListener("pointerup",up);el.addEventListener("pointercancel",cancel);el.addEventListener("pointerleave",leave);el.addEventListener("wheel",wheel,{passive:false});el.addEventListener("keydown",key);resize();
    return()=>{observer.disconnect();cancelAnimationFrame(frame);engine.current=null;el.removeEventListener("pointerdown",down);el.removeEventListener("pointermove",move);el.removeEventListener("pointerup",up);el.removeEventListener("pointercancel",cancel);el.removeEventListener("pointerleave",leave);el.removeEventListener("wheel",wheel);el.removeEventListener("keydown",key);};
  },[nodes,edges,positions,summary]);
  const current=hover??nodes.find(n=>n.id===selected);
  return <div className={[s.canvasWrap,expanded?s.canvasExpanded:""].join(" ")} style={expanded?expandedBounds:undefined}>
    <div className={s.graphTools}><span>{nodes.length.toLocaleString()}개 {summary?"유형":"기록"} · {edges.length.toLocaleString()}개 연결선</span><div><button aria-label="축소" onClick={()=>engine.current?.zoom(.8)}>−</button><output aria-label="확대 비율">{zoom}%</output><button aria-label="확대" onClick={()=>engine.current?.zoom(1.25)}>＋</button><button onClick={()=>engine.current?.fit()}>전체 맞춤</button><button disabled={!selected} onClick={()=>engine.current?.center()}>선택 중심</button><button aria-pressed={expanded} onClick={()=>setExpanded(x=>!x)}>{expanded?"넓게 보기 닫기":"넓게 보기"}</button></div></div>
    <div className={s.canvasStage}><canvas ref={canvas} className={s.canvas} tabIndex={0} role="img" aria-label={"지식그래프 "+nodes.length+"개 기록. 휠로 확대, 배경을 끌어 이동, 점을 선택하거나 이동합니다. 키보드 방향키로 이동, 더하기·빼기로 확대, 0으로 전체 맞춤. 기록 검색 목록에서도 선택할 수 있습니다."}/>{current&&<div className={s.hoverCard}><strong>{current.label}</strong><span>{current.missing?current.unloaded?"상세 조회 필요":"연결 확인 필요":current.count.toLocaleString()+"개 "+(summary?"기록":"이웃 기록")}{current.incomplete?" · "+current.incomplete:""}</span></div>}</div>
    <div className={s.networkLegend}><div><label><input type="checkbox" checked={colored} onChange={e=>setColored(e.target.checked)}/>주체별 색상</label><label><input type="checkbox" checked={labels} onChange={e=>setLabels(e.target.checked)}/>이름 표시</label></div><span>● 기록 · 큰 점: 연결이 많은 기록 · ◎ 연결 없음 · 붉은 점선: 보완 · 회색 점선: 상세 조회 · 노랑 테두리: 확인 필요</span><small>휠로 확대 · 배경/점을 끌어 이동 · 점을 선택하면 연결 근거 확인</small></div>
  </div>;
}


