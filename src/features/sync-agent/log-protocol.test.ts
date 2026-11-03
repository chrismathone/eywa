import { it,expect } from "vitest";
import { EventInput } from "./protocol";
it("accepts only fixed worker log codes and rejects raw text or unknown detail fields",()=>{
 const event={id:"68636d0d-812a-41c5-9e9d-37d13f3951d6",at:"2026-10-09T00:00:00Z",module:"makeedu",level:"info",kind:"worker_log",detail:{logCode:"makeedu_students"}};
 expect(EventInput.safeParse(event).success).toBe(true);
 expect(EventInput.safeParse({...event,detail:{logCode:"학생이름 private"}}).success).toBe(false);
 expect(EventInput.safeParse({...event,detail:{logCode:"makeedu_students",stdout:"private"}}).success).toBe(false);
 // 실행기 교체·넘겨받기(AywaSync 1.0.12) — 웹이 먼저 받아야 연동 PC 로그가 안 버려진다.
 for(const logCode of ["launcher_updated","launcher_update_failed","launcher_handover"])expect(EventInput.safeParse({...event,module:"update",detail:{logCode}}).success).toBe(true);
});
it("accepts fixed update failure reasons without exposing arbitrary messages",()=>{
 const event={id:"68636d0d-812a-41c5-9e9d-37d13f3951d6",at:"2026-10-09T00:00:00Z",module:"update",level:"warning",kind:"update_failed",detail:{updateError:"download_timeout",version:"1.0.3"}};
 expect(EventInput.safeParse(event).success).toBe(true);
 expect(EventInput.safeParse({...event,detail:{updateError:"private path or token"}}).success).toBe(false);
 expect(EventInput.safeParse({...event,detail:{updateError:"download_timeout",error:"private"}}).success).toBe(false);
});
