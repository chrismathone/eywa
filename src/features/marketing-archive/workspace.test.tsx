import { beforeEach,describe,it,expect,vi } from "vitest";
import { render,screen,fireEvent,waitFor,cleanup,within } from "@testing-library/react";
const refresh=vi.hoisted(()=>vi.fn());vi.mock("next/navigation",()=>({useRouter:()=>({refresh}),usePathname:()=>"/marketing",useSearchParams:()=>new URLSearchParams()}));
import { ArchiveWorkspace } from "./workspace";
import {blankEvent} from "./model";
import type {ArchiveData} from "./server";
const data:ArchiveData={today:"2026-11-10",canWrite:true,staff:[],sources:[],edges:[],links:[],deletedEvents:[],events:[{id:"00000000-0000-4000-8000-000000000001",version:1,updated_at:"2026-11-10",document:{...blankEvent(),title:"250207 EiE 설명회",date:"2025-02-07",reservationRaw:"13",attendanceRaw:"6명 (취소 7명)",actualCost:254114,costReference:"비용표",raw:{"설명회명 및 날짜":"250207 EiE 설명회"}}}]};
describe("unified marketing workspace",()=>{
 beforeEach(()=>{cleanup();vi.clearAllMocks();Element.prototype.scrollIntoView=vi.fn();vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({record:{id:"saved"}})}));});
 it("keeps raw reported attendance separate from confirmed counts and preserves source fields on save",async()=>{render(<ArchiveWorkspace data={data}/>);fireEvent.click(screen.getByRole("button",{name:"250207 EiE 설명회"}));fireEvent.click(screen.getByRole("button",{name:"③ 참석·비용·성과"}));expect(screen.getByLabelText("확인한 실제 참석 인원")).toHaveValue(null);fireEvent.change(screen.getByLabelText("확인한 실제 참석 인원"),{target:{value:"6"}});fireEvent.click(screen.getByRole("button",{name:"프로젝트 저장"}));await waitFor(()=>expect(fetch).toHaveBeenCalled());const request=JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);expect(request.document.attendees).toBe(6);expect(request.document.attendanceRaw).toBe("6명 (취소 7명)");expect(request.document.raw).toEqual(data.events[0].document.raw);});
 it("compares the same month across the three years before the chosen planning year",()=>{
   const november = [2023, 2024, 2025].map(year => ({
     ...data.events[0], id:String(year),
     document:{...blankEvent(), title:`${year}년 설명회`, date:`${year}-11-03`},
   }));
   render(<ArchiveWorkspace data={{...data,events:[...data.events,...november]}} initialView="annual"/>);
   fireEvent.change(screen.getByLabelText("기획 연도"),{target:{value:"2026"}});
   const selectedMonth=screen.getByRole("button",{name:"11월 비교"});
   expect(selectedMonth).toHaveAttribute("aria-pressed","true");
   expect(selectedMonth).toHaveAccessibleDescription("2023년 1건, 2024년 1건, 2025년 1건");
   for (const year of [2023, 2024, 2025]) {
     const column=screen.getByRole("region",{name:`${year}년 11월 행사`});
     expect(within(column).getByRole("button",{name:`${year}년 설명회`})).toBeInTheDocument();
   }
   expect(screen.queryByRole("button",{name:"250207 EiE 설명회"})).toBeNull();
   fireEvent.click(screen.getByRole("button",{name:"2월 비교"}));
   expect(screen.getByRole("button",{name:"250207 EiE 설명회"})).toBeInTheDocument();
   expect(screen.queryByRole("button",{name:"2025년 설명회"})).toBeNull();
 });
 it("creates a plan for the selected year and month using a past event as reference",async()=>{
   render(<ArchiveWorkspace data={data} initialView="annual"/>);
   fireEvent.change(screen.getByLabelText("기획 연도"),{target:{value:"2026"}});
   fireEvent.click(screen.getByRole("button",{name:"2월 비교"}));
   fireEvent.click(screen.getByRole("button",{name:"이 기록으로 2026 기획"}));
   fireEvent.click(screen.getByRole("button",{name:"프로젝트 저장"}));
   await waitFor(()=>expect(fetch).toHaveBeenCalled());
   const request=JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
   expect(request.document).toMatchObject({
     referenceEventId:data.events[0].id, state:"planned", date:"2026-02-07",
     period:"2026-02", actualCost:null, attendanceRaw:"", raw:{},
   });
 });
 it("adds a missing record with the historical year and month already selected",async()=>{
   render(<ArchiveWorkspace data={data} initialView="annual"/>);
   fireEvent.click(screen.getByRole("button",{name:"2024년 11월 행사 추가"}));
   expect(screen.getByLabelText("기록 월(YYYY-MM)")).toHaveValue("2024-11");
   fireEvent.change(screen.getByLabelText("행사·캠페인명"),{target:{value:"누락된 11월 행사"}});
   fireEvent.click(screen.getByRole("button",{name:"프로젝트 저장"}));
   await waitFor(()=>expect(refresh).toHaveBeenCalled());
   const request=JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
   expect(request).toMatchObject({kind:"event",id:null,document:{title:"누락된 11월 행사",period:"2024-11",state:"review"}});
 });
 it("confirms deletion and restores using the latest version",async()=>{
   const event=data.events[0];
   const {rerender}=render(<ArchiveWorkspace data={data}/>);
   fireEvent.click(screen.getByRole("button",{name:`${event.document.title} 삭제`}));
   const dialog=screen.getByRole("alertdialog");
   expect(within(dialog).getByText(/EiE 설명회/)).toBeInTheDocument();
   expect(fetch).not.toHaveBeenCalled();
   fireEvent.click(within(dialog).getByRole("button",{name:"삭제"}));
   await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
   expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string))
     .toEqual({kind:"event_visibility",id:event.id,version:1,document:{deleted:true}});
   rerender(<ArchiveWorkspace data={{...data,events:[],deletedEvents:[{
     id:event.id,version:2,title:event.document.title,schedule:event.document.date,deletedAt:"2026-11-13T12:00:00Z",
   }]}}/>);
   expect(screen.queryByRole("button",{name:event.document.title})).toBeNull();
   fireEvent.click(screen.getByRole("button",{name:"삭제한 행사 (1)"}));
   fireEvent.click(screen.getByRole("button",{name:`${event.document.title} 복구`}));
   await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(2));
   expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string))
     .toEqual({kind:"event_visibility",id:event.id,version:2,document:{deleted:false}});
 });
 it("keeps mutation controls out of the read-only view",()=>{
   render(<ArchiveWorkspace data={{...data,canWrite:false}} initialView="annual"/>);
   fireEvent.click(screen.getByRole("button",{name:"2월 비교"}));
   expect(screen.getByRole("button",{name:data.events[0].document.title})).toBeInTheDocument();
   expect(screen.queryByRole("button",{name:/추가|삭제|이 기록으로/})).toBeNull();
 });
});
