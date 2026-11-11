import {fireEvent,render,screen,within,waitFor,cleanup} from "@testing-library/react";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {FollowupWorkspace} from "./followup-workspace";
import {fixture,managerId,teacherId} from "./followup-fixtures.test-support";
import {EMPTY_FILTERS} from "./board-model";
const m=vi.hoisted(()=>({assign:vi.fn(),report:vi.fn(),review:vi.fn(),check:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:m.refresh})}));
vi.mock("./server/followup-actions",()=>({assignNewcomerManager:m.assign,submitNewcomerFeedback:m.report,reviewNewcomerFeedback:m.review}));
vi.mock("./server/actions",()=>({setOnboardingCheck:m.check}));
vi.mock("./server/manager-defaults-actions",()=>({saveNewcomerDefaultManager:vi.fn()}));
vi.mock("@/features/owner/operations-context",()=>({useSubjectMaps:()=>({labelOf:(s:string)=>s==="math"?"수학":"영어"})}));
vi.mock("@/components/embed-link",()=>({EmbedLink:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
beforeEach(()=>{Object.values(m).forEach(f=>f.mockReset());m.assign.mockResolvedValue({ok:true});m.report.mockResolvedValue({ok:true});m.review.mockResolvedValue({ok:true});});
afterEach(cleanup);
it("수강 연결 누락은 관리자 미지정과 분리하고 학생 상세로 안내",()=>{
  const f=fixture(),s=f.data.students[0];
  s.subjects=[{...s.subjects[0],subject:null,rowKey:`${s.row.studentId}|`}];s.managers=[];s.homerooms=[];
  render(<FollowupWorkspace {...f} initialFilters={EMPTY_FILTERS}/>);
  expect(screen.getByRole('button',{name:/담당·수강 연결 확인/})).toHaveTextContent('수강 연결 필요 1명');
  fireEvent.click(screen.getByRole('button',{name:'담당 미지정'}));
  expect(screen.queryByRole('button',{name:'정착테스트'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'수강 연결 필요'}));
  expect(screen.getByRole('link',{name:'수강반 연결 확인 ↗'})).toHaveAttribute('href',`/students/${s.row.studentId}`);
});
it("두 과목을 학생 한 줄로 보여주고 관리자·담임·실제 수행자를 표시",()=>{render(<FollowupWorkspace {...fixture()} initialFilters={EMPTY_FILTERS}/>);expect(screen.getAllByRole("row")).toHaveLength(3);expect(screen.getAllByRole("columnheader")).toHaveLength(5);expect(screen.getByRole("button",{name:"정착테스트 수학 30일 콜 완료"})).toHaveTextContent("박관리");expect(within(screen.getByRole("table")).getByText("김담임")).toBeInTheDocument();expect(within(screen.getByRole("table")).getByText("이담임")).toBeInTheDocument();});
it("완료된 수학의 처리자·결과를 확인하고 영어는 별도 입력",()=>{render(<FollowupWorkspace {...fixture()} initialFilters={EMPTY_FILTERS}/>);fireEvent.click(screen.getByRole("button",{name:"정착테스트 영어 30일 콜 기한 경과"}));expect(screen.getByLabelText("관리 콜 대상 과목")).toHaveValue("english");fireEvent.change(screen.getByLabelText("관리 콜 대상 과목"),{target:{value:"math"}});expect(screen.getByText(/완료 2026-10-30 · 실제 처리자 박관리/)).toBeInTheDocument();expect(screen.getByText(/수행: 만족도 전화/)).toBeInTheDocument();});
it("저장 실패 시 관찰 내용을 보존하고 오류를 알린다",async()=>{m.report.mockResolvedValue({ok:false,error:"잠시 후 다시 저장해 주세요"});render(<FollowupWorkspace {...fixture()} initialFilters={EMPTY_FILTERS}/>);fireEvent.click(screen.getByRole("button",{name:"정착테스트 수학 피드백·점검"}));fireEvent.change(screen.getByLabelText("관찰·학부모 반응·지도 결과"),{target:{value:"과제 조정에 잘 적응함"}});fireEvent.click(screen.getByRole("button",{name:"피드백 보고"}));await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("다시 저장"));expect(screen.getByLabelText("관찰·학부모 반응·지도 결과")).toHaveValue("과제 조정에 잘 적응함");expect(m.refresh).not.toHaveBeenCalled();});
it("관리 담당 저장 시 현재 버전을 전달",async()=>{render(<FollowupWorkspace {...fixture()} initialFilters={EMPTY_FILTERS}/>);fireEvent.click(screen.getByRole("button",{name:"정착테스트"}));fireEvent.click(screen.getByRole("button",{name:"담당 저장"}));await waitFor(()=>expect(m.assign).toHaveBeenCalledWith(expect.objectContaining({managerId,subject:"math",mode:"manual",version:1})));});
it("강사는 관리자 확인 대신 본인 보고의 후속 조치를 처리",()=>{const f=fixture();f.data.canManage=false;f.data.actorId=teacherId;render(<FollowupWorkspace {...f} initialFilters={EMPTY_FILTERS}/>);fireEvent.click(screen.getByRole("button",{name:"정착테스트 수학 피드백·점검"}));const report=screen.getByRole("article",{name:"김담임 30일 피드백"});expect(within(report).queryByRole("button",{name:"확인 완료"})).not.toBeInTheDocument();expect(within(report).getByRole("button",{name:"후속 조치 완료"})).toBeDisabled();expect(screen.queryByRole("button",{name:"담당 저장"})).not.toBeInTheDocument();});
it("조회 오류는 0건으로 보이지 않는다",()=>{const f=fixture();f.data.error="조회 실패";render(<FollowupWorkspace {...f} initialFilters={EMPTY_FILTERS}/>);expect(screen.getByRole("alert")).toHaveTextContent("조회 실패");expect(screen.getByRole("button",{name:/확인할 피드백/})).toHaveTextContent("—");});

it("한국 자정 이후 보고일은 한국 날짜이며 학생 링크는 보고 이력을 연다",()=>{const f=fixture();f.data.students[0].reports[0].created_at="2026-11-02T15:05:00Z";render(<FollowupWorkspace {...f} initialFilters={EMPTY_FILTERS} initialStudent={f.data.students[0].row.studentId}/>);expect(screen.getByRole("article",{name:"김담임 30일 피드백"})).toHaveTextContent("11.03");expect(screen.getByRole("button",{name:"피드백 보고"})).toBeInTheDocument();});

it("학생 이름 한 번, 두 과목 관리자와 별도 기록 화면",()=>{render(<FollowupWorkspace {...fixture()} initialFilters={EMPTY_FILTERS}/>);expect(screen.getAllByRole("button",{name:"정착테스트"})).toHaveLength(1);expect(screen.getByRole("button",{name:"정착테스트 영어 관리 담당자"})).toHaveTextContent("정유진");fireEvent.click(screen.getByRole("button",{name:"정착테스트 영어 피드백·점검"}));expect(screen.getByLabelText("과목",{exact:true})).toHaveValue("english");expect(screen.queryByRole("article",{name:"김담임 30일 피드백"})).not.toBeInTheDocument();fireEvent.click(within(screen.getByRole("group",{name:"학생 과목 선택"})).getByRole("button",{name:"수학"}));expect(screen.getByRole("article",{name:"김담임 30일 피드백"})).toBeInTheDocument();});
it("담당자별 기한 경과는 본인 과목만 계산",()=>{render(<FollowupWorkspace {...fixture()} initialFilters={EMPTY_FILTERS}/>);fireEvent.click(screen.getByRole("button",{name:"담당자별 점검"}));const manager=screen.getByRole("heading",{name:"박관리"}).closest("article")!;expect(within(manager).getByText("기한 지난 관리 콜").nextElementSibling).toHaveTextContent("0건");});
