import {beforeEach,it,expect,vi} from "vitest";
import {assignNewcomerManager,submitNewcomerFeedback,reviewNewcomerFeedback} from "./followup-actions";
import {studentId,managerId,teacherId,reportId} from "../followup-fixtures.test-support";
const m=vi.hoisted(()=>({takes:vi.fn(),access:vi.fn(),rooms:vi.fn(),readonly:vi.fn(),actor:vi.fn(),from:vi.fn(),refresh:vi.fn(),queue:[] as unknown[],calls:[] as {table:string;method:string;args:unknown[]}[]}));
vi.mock("./followup-query",()=>({followupAccess:m.access,loadHomerooms:m.rooms}));
vi.mock("@/lib/auth/current-user",()=>({getCurrentUser:m.actor}));
vi.mock("@/lib/auth/view-as",()=>({readonlyTeacherViewError:m.readonly}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({from:m.from})}));
vi.mock("next/cache",()=>({revalidatePath:m.refresh}));
vi.mock("./consult-link",()=>({studentTakesSubject:m.takes}));
const tenant="test-tenant";
beforeEach(()=>{
  m.queue=[];m.calls=[];Object.values(m).filter(v=>typeof v==="function").forEach(v=>(v as ReturnType<typeof vi.fn>).mockReset());
  m.access.mockResolvedValue({user:{id:teacherId,tenantId:tenant},scoped:true,canManage:false,canReport:true});
  m.actor.mockResolvedValue({id:teacherId,tenantId:tenant});
  m.rooms.mockResolvedValue(new Map([[studentId,[{id:teacherId,subject:"math",name:"담임",upcoming:false}]]]));
  m.takes.mockResolvedValue({ok:true,takes:true});m.readonly.mockResolvedValue(null);
  m.from.mockImplementation((table:string)=>{const result=m.queue.shift()??{data:null,error:null};const proxy:unknown=new Proxy({}, {get:(_,key)=>key==="then"?(resolve:(v:unknown)=>void)=>Promise.resolve(result).then(resolve):(...args:unknown[])=>{m.calls.push({table,method:String(key),args});return proxy;}});return proxy;});
  m.queue.push({data:{id:studentId},error:null});
});
const input=()=>({id:reportId,studentId,subject:"math",stage:"d30",condition:"watch",summary:"적응 관찰을 기록합니다",nextAction:"",nextDue:null});
const manage=()=>m.access.mockResolvedValue({user:{id:managerId,tenantId:tenant},scoped:false,canManage:true,canReport:true});
it("읽기 전용 강사뷰와 다른 지점 학생의 쓰기 차단",async()=>{m.readonly.mockResolvedValue("읽기");expect((await submitNewcomerFeedback(input())).ok).toBe(false);expect(m.from).not.toHaveBeenCalled();m.takes.mockResolvedValue({ok:true,takes:true});m.readonly.mockResolvedValue(null);m.queue=[{data:null,error:null}];expect((await submitNewcomerFeedback(input())).ok).toBe(false);expect(m.calls.filter(c=>c.method==="insert")).toHaveLength(0);});
it("강사는 본인 과목만 보고하고 관리자 배정·확인은 할 수 없다",async()=>{expect((await submitNewcomerFeedback({...input(),subject:"english"})).error).toContain("담당하는 과목");m.queue=[{data:{id:studentId},error:null}];expect((await assignNewcomerManager({studentId,subject:"math",mode:"manual",managerId,version:0})).error).toContain("권한");m.queue=[{data:{id:studentId},error:null},{data:{id:reportId,author_id:teacherId,subject:"math",version:1,next_action:"",review_state:"pending"}}];expect((await reviewNewcomerFeedback({id:reportId,studentId,version:1,operation:"confirmed",note:"확인"})).error).toContain("관리자만");expect(m.calls.filter(c=>c.method==="insert"||c.method==="update")).toHaveLength(0);});
it("담당 반이 없는 학생에게 보고 불가",async()=>{m.rooms.mockResolvedValue(new Map());expect((await submitNewcomerFeedback(input())).error).toContain("담당 학생");});
it("외부 지점 또는 비활성 관리 담당자 배정 거부",async()=>{manage();m.queue.push({data:null,error:null});expect((await assignNewcomerManager({studentId,subject:"math",mode:"manual",managerId,version:0})).ok).toBe(false);expect(m.calls.filter(c=>c.method==="insert")).toHaveLength(0);expect(m.calls).toContainEqual({table:"users",method:"eq",args:["tenant_id",tenant]});});
it("배정 갱신 버전 충돌을 성공으로 처리하지 않는다",async()=>{manage();m.queue.push({data:null,error:null});expect((await assignNewcomerManager({studentId,subject:"math",mode:"manual",managerId:null,version:2})).error).toContain("먼저 수정");expect(m.calls).toContainEqual({table:"student_onboarding_subject_assignments",method:"eq",args:["version",2]});expect(m.refresh).not.toHaveBeenCalled();});
it("본인 보고는 학생·과목·실제 로그인 감사자를 저장",async()=>{m.actor.mockResolvedValue({id:managerId,tenantId:tenant});m.queue.push({data:null,error:null});expect((await submitNewcomerFeedback(input())).ok).toBe(true);const saved=m.calls.find(c=>c.method==="insert")!.args[0];expect(saved).toMatchObject({tenant_id:tenant,student_id:studentId,subject:"math",author_id:teacherId,updated_by:managerId});});
it("재전송 ID에 다른 내용을 덮어쓰지 않는다",async()=>{m.queue.push({error:{code:"23505"}},{data:{...input(),author_id:teacherId,student_id:studentId,next_action:"",next_due:null,summary:"다른 내용"},error:null});expect((await submitNewcomerFeedback(input())).error).toContain("먼저 수정");});
it("본인의 보완 보고는 관리자 확인 대기로 돌아간다",async()=>{m.queue.push({data:{id:reportId,author_id:teacherId,subject:"math",version:2,review_state:"revision",next_action:""},error:null},{data:{id:reportId},error:null});expect((await reviewNewcomerFeedback({id:reportId,studentId,version:2,operation:"respond",note:"학부모 반응을 추가 확인했습니다"})).ok).toBe(true);expect(m.calls.find(c=>c.method==="update")!.args[0]).toMatchObject({review_state:"pending",response:"학부모 반응을 추가 확인했습니다",version:3});});
it("타인의 보고 후속 처리와 이전 버전의 확인 차단",async()=>{m.queue.push({data:{id:reportId,author_id:managerId,subject:"math",version:1,next_action:"콜",followup_at:null}});expect((await reviewNewcomerFeedback({id:reportId,studentId,version:1,operation:"resolve",note:"완료"})).ok).toBe(false);manage();m.queue=[{data:{id:studentId}},{data:{id:reportId,version:3}}];expect((await reviewNewcomerFeedback({id:reportId,studentId,version:1,operation:"confirmed",note:"확인"})).error).toContain("먼저 수정");});

it("읽기 전용 권한은 담당 학생도 작성 불가",async()=>{m.access.mockResolvedValue({user:{id:teacherId,tenantId:tenant},scoped:true,canManage:false,canReport:false});expect((await submitNewcomerFeedback(input())).ok).toBe(false);expect(m.from).not.toHaveBeenCalled();});

it("과목별 관리자 변경은 다른 과목에 영향을 주지 않는 조건으로 저장",async()=>{manage();m.queue.push({data:{id:managerId}},{data:{version:3}});expect((await assignNewcomerManager({studentId,subject:"english",mode:"manual",managerId,version:2})).ok).toBe(true);expect(m.calls).toContainEqual({table:"student_onboarding_subject_assignments",method:"eq",args:["subject","english"]});expect(m.calls.find(c=>c.method==="update")!.args[0]).toMatchObject({subject:"english",manager_id:managerId,version:3});});
it("수강하지 않는 과목 배정과 과목 없는 구형 요청 차단",async()=>{manage();m.takes.mockResolvedValue({ok:true,takes:false});expect((await assignNewcomerManager({studentId,subject:"eie",mode:"manual",managerId,version:0})).ok).toBe(false);expect((await assignNewcomerManager({studentId,managerId,version:0})).ok).toBe(false);expect(m.calls.filter(c=>["insert","update"].includes(c.method))).toHaveLength(0);});
