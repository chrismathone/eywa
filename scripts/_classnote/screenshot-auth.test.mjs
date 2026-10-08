import {describe,it,expect} from "vitest";
import {protectScreenshotHeaders} from "./screenshot-auth.mjs";
describe("screenshot credential confinement",()=>{
  it("does not send the device secret to images, CDNs or redirect targets",async()=>{
    let handler;await protectScreenshotHeaders({route:async(_pattern,fn)=>{handler=fn;}},"https://app.test","fixture-secret");
    for(const [url,navigation]of [["https://cdn.test/image",false],["https://evil.test/r/a",true],["https://app.test/api/other",false]]){
      let output;await handler({request:()=>({url:()=>url,isNavigationRequest:()=>navigation,headers:()=>({'x-eywa-internal':'inherited',accept:'image/*'})}),continue:async options=>{output=options;},fetch:()=>{throw new Error('unexpected privileged fetch');}});
      expect(output.headers).toEqual({accept:'image/*'});
    }
  });
  it("authorizes only the original report navigation and never follows its redirect with the secret",async()=>{
    let handler;await protectScreenshotHeaders({route:async(_pattern,fn)=>{handler=fn;}},"https://app.test","fixture-secret");
    let fetched,fulfilled;const response={status:()=>302};await handler({request:()=>({url:()=>"https://app.test/r/token",isNavigationRequest:()=>true,headers:()=>({})}),fetch:async options=>{fetched=options;return response;},fulfill:async options=>{fulfilled=options;}});
    expect(fetched).toEqual({headers:{'x-eywa-internal':'fixture-secret'},maxRedirects:0});expect(fulfilled).toEqual({response});
  });
});
