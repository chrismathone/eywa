using System;
using System.IO;
using System.Linq;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class Bootstrap {
  const string PublicKey = "__PUBLIC_KEY_XML__";
  // 실행기 판(1.0.13 = 2). 포장 폴더의 aywa-launcher.json에도 같은 값을 적는다 — 본체가 이 값을 보고 설치 폴더의 옛 실행기를 바꾸고,
  // 옛 실행기에서 업데이트를 넘겨받는다. 이 파일의 동작을 바꾸면 이 값과 after-pack.cjs의 값을 함께 올린다.
  const int LauncherVersion = 2;
  const string MutexName = "Local\\AYWA.Sync.Bootstrap", ShowName = "Local\\AYWA.Sync.Show";
  // --show(창만 띄우기)를 아는 첫 본체 순번(1.0.13 = 15). 그 전 본체는 --show를 모르고 주인이 되어 버리므로 보내지 않는다.
  // (처음엔 1.0.13/14로 준비했으나 14번은 다른 변경(반 보드 해제 확대)이 가져갔다 — 14번 본체는 --show를 모른다.)
  const int ShowSinceSequence = 15;
  static JavaScriptSerializer json=new JavaScriptSerializer {MaxJsonLength=8*1024*1024};
  static string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"AYWA","Sync");
  // 설치 폴더 = 이 실행기가 있는 곳. 설치 폴더에 쓸 수 없어 본체가 지점 폴더에 복사해 둔 실행기만 --install-dir로 받는다.
  static string installed=AppDomain.CurrentDomain.BaseDirectory;
  // 설치 폴더 본체의 순번 = 설치 파일이 넣은 aywa-install.json. 없으면 0(모름) — 옛 설치 폴더에 실행기만 새로 들어온 경우다.
  static int installedSequence=0;
  static string journal=Path.Combine(root,"launch.json");
  static readonly object gate=new object();
  static string runningExe=null;static int runningSequence=0;static DateTime runningSince=DateTime.MinValue;static bool runningReady=false,pendingShow=false;
  static Dictionary<string,object> Read(string file){return json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file,Encoding.UTF8));}
  static int Number(Dictionary<string,object> d,string key,int fallback){object v;return d.TryGetValue(key,out v)?Convert.ToInt32(v):fallback;}
  static void Save(Dictionary<string,object> d){string temp=journal+".bootstrap";File.WriteAllText(temp,json.Serialize(d),new UTF8Encoding(false));if(File.Exists(journal))File.Replace(temp,journal,null);else File.Move(temp,journal);}
  static string ValidatedRuntime(int sequence) {
    if(installedSequence>0&&sequence==installedSequence)return Path.Combine(installed,"AywaSyncRuntime.exe");
    if(installedSequence>0&&sequence<installedSequence)throw new Exception("version");
    string dir=Path.Combine(root,"versions",sequence.ToString());
    // 순번을 모르는 옛 설치 폴더: 받은 버전 폴더가 없으면 옛 실행기처럼 설치 폴더 본체를 띄운다(되돌릴 곳이 설치본인 경우).
    if(installedSequence==0&&!File.Exists(Path.Combine(dir,"release.json")))return Path.Combine(installed,"AywaSyncRuntime.exe");
    var envelope=Read(Path.Combine(dir,"release.json"));
    byte[] payload=Convert.FromBase64String((string)envelope["payload"]),signature=Convert.FromBase64String((string)envelope["signature"]);
    using(var rsa=new RSACryptoServiceProvider()){rsa.FromXmlString(PublicKey);if(!rsa.VerifyData(payload,"SHA256",signature))throw new Exception("signature");}
    var manifest=json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(payload));
    if(Number(manifest,"sequence",0)!=sequence||Number(manifest,"protocol",0)!=1)throw new Exception("manifest");
    var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach(Dictionary<string,object> entry in (ArrayList)manifest["files"]){
      string relative=(string)entry["path"];
      if(relative.Contains("\\")||relative.Contains(":")||relative.Split('/').Any(p=>p==""||p=="."||p==".."||p.EndsWith(".")||p.EndsWith(" "))||!seen.Add(relative))throw new Exception("path");
      string file=Path.GetFullPath(Path.Combine(dir,relative.Replace('/',Path.DirectorySeparatorChar)));
      if(!file.StartsWith(dir+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("path");
      for(string part=file;part!=dir;part=Path.GetDirectoryName(part))if((File.GetAttributes(part)&FileAttributes.ReparsePoint)!=0)throw new Exception("link");
      var info=new FileInfo(file);if(info.Length!=Convert.ToInt64(entry["size"]))throw new Exception("size");
      using(var sha=SHA256.Create())using(var stream=File.OpenRead(file)){string hash=BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();if(hash!=(string)entry["sha256"])throw new Exception("hash");}
    }
    if(!seen.Contains("AywaSyncRuntime.exe")||!seen.Contains("resources/app.asar"))throw new Exception("missing");
    return Path.Combine(dir,"AywaSyncRuntime.exe");
  }
  // 창만 띄워 달라는 실행 — 본체는 --show로 켜지면 주인이 되지 않고 끝난다(1.0.13). 주인 본체가 있으면 그 창이 뜬다.
  // 본체·실행기가 남기는 표식 파일은 지점 폴더 바로 아래의 정해진 이름만(건강 파일과 같은 규칙).
  static string MarkerPath(string value,string prefix){try{string full=Path.GetFullPath(value);return string.Equals(Path.GetDirectoryName(full),Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar),StringComparison.OrdinalIgnoreCase)&&Path.GetFileName(full).StartsWith(prefix,StringComparison.Ordinal)?full:null;}catch{return null;}}
  static string Option(string[] args,string name){foreach(string a in args)if(a.StartsWith(name,StringComparison.Ordinal))return a.Substring(name.Length);return null;}
  // 본체가 주인 잠금을 쥘 시간(5초)이 지났거나 건강 확인을 마쳤으면 창 띄우기를 바로 넘긴다 — 그 전에 넘기면 --show 실행이 잠금을 먼저 쥘 수 있다.
  static bool CanForward(){return runningExe!=null&&runningSequence>=ShowSinceSequence&&(runningReady||DateTime.UtcNow-runningSince>=TimeSpan.FromSeconds(5));}
  static void StartShow(string exe){try{Process.Start(new ProcessStartInfo(exe,"--show"){UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(exe)});}catch{}}
  // 두 번째 실행(바탕화면 아이콘을 또 누름)은 주인 실행기에 신호만 보낸다 — 본체를 직접 띄우면 주인 본체가 뜨기 전에 잠금을 가로채 옛 버전이 주인이 될 수 있었다.
  static void RequestShow(){
    try{EventWaitHandle signal;if(EventWaitHandle.TryOpenExisting(ShowName,out signal)){using(signal)signal.Set();return;}}catch{}
    // 주인이 옛 판 실행기(신호를 모른다): 지금 버전 본체에 창만 띄워 달라고 한다. 모르는 옛 설치본은 띄우지 않는다.
    string exe=null;int sequence=0;
    try{int current=Number(Read(journal),"current",installedSequence);string candidate=Path.Combine(root,"versions",current.ToString(),"AywaSyncRuntime.exe");
      if(File.Exists(candidate)){exe=candidate;sequence=current;}else if(installedSequence>0&&current==installedSequence){exe=Path.Combine(installed,"AywaSyncRuntime.exe");sequence=installedSequence;}}catch{}
    if(exe==null&&installedSequence>0){exe=Path.Combine(installed,"AywaSyncRuntime.exe");sequence=installedSequence;}
    if(exe!=null&&sequence>=ShowSinceSequence)StartShow(exe);
  }
  static void ListenForShow(){
    EventWaitHandle signal;try{bool created;signal=new EventWaitHandle(false,EventResetMode.AutoReset,ShowName,out created);}catch{return;}
    var listener=new Thread(()=>{
      while(true){
        try{signal.WaitOne();}catch{return;}
        // 본체가 잠금을 쥔 뒤에만 넘긴다 — 그 전이면 기억해 두었다가 띄울 때(--hidden 없이)·5초 뒤에 보여 준다.
        string exe=null;lock(gate){if(CanForward())exe=runningExe;else pendingShow=true;}
        if(exe!=null)StartShow(exe);
      }
    }){IsBackground=true};
    listener.Start();
  }
  [STAThread] static void Main(string[] args){
    Directory.CreateDirectory(root);
    // 자가 시험: 본체가 이 실행기를 진입점에 넣기 전에 그 자리에서 한 번 돌려 본다 — 판 숫자만 적고 끝난다.
    string selftest=Option(args,"--selftest=");if(selftest!=null){string file=MarkerPath(selftest,"selftest-");if(file!=null)File.WriteAllText(file,"launcher:"+LauncherVersion,new UTF8Encoding(false));return;}
    string dirOption=Option(args,"--install-dir=");if(dirOption!=null&&Directory.Exists(dirOption))installed=Path.GetFullPath(dirOption).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
    try{installedSequence=Math.Max(0,Number(Read(Path.Combine(installed,"aywa-install.json")),"sequence",0));}catch{installedSequence=0;}
    // 설치 폴더에 표식을 쓸 수 없었을 때 본체가 알려 주는 설치본 순번.
    int given;if(installedSequence==0&&int.TryParse(Option(args,"--install-sequence=")??"",out given)&&given>0)installedSequence=given;
    // Electron is the single-instance authority for the runtime; this mutex keeps one launcher per Windows session.
    bool owner;using(var mutex=new Mutex(true,MutexName,out owner)){
      // 업데이트를 넘겨받는 실행기(--handover)는 앞 실행기가 끝나 잠금이 풀릴 때까지 기다린다 — 앞 실행기는 본체가 끝나면 바로 끝난다.
      if(args.Contains("--handover")){
        // 넘겨주는 본체는 이 표식을 보고서야 끝난다 — 이 실행기가 못 떴으면 본체가 옛 실행기에 맡긴다(42).
        string ready=Option(args,"--handover-ready=");if(ready!=null){string file=MarkerPath(ready,"handover-");if(file!=null)try{File.WriteAllText(file,"waiting",new UTF8Encoding(false));}catch{}}
        if(!owner){try{owner=mutex.WaitOne(TimeSpan.FromSeconds(120));}catch(AbandonedMutexException){owner=true;}}
      }
      if(!owner){RequestShow();return;}
      try{ListenForShow();Run(args);}finally{try{mutex.ReleaseMutex();}catch{}}
    }
  }
  static void Run(string[] args){
    int lockMisses=0;
    for(int attempt=0;attempt<3;attempt++){
      Dictionary<string,object> state;try{state=Read(journal);}catch{state=new Dictionary<string,object>();}
      int sequence=installedSequence,previous=installedSequence;bool trial=false;
      try{sequence=Number(state,"current",installedSequence);previous=Number(state,"previous",installedSequence);trial=state.ContainsKey("trial")&&(bool)state["trial"];}catch{state=new Dictionary<string,object>();sequence=installedSequence;previous=installedSequence;trial=false;}
      if(installedSequence>0&&sequence<installedSequence){sequence=installedSequence;previous=installedSequence;trial=false;}
      string health=Path.Combine(root,"health-"+Guid.NewGuid().ToString("N"));
      try {
        string exe=ValidatedRuntime(sequence);
        bool showNow;lock(gate){showNow=pendingShow;pendingShow=false;runningExe=exe;runningSequence=sequence;runningReady=false;runningSince=DateTime.UtcNow;}
        var start=new ProcessStartInfo(exe){UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(exe)};
        start.EnvironmentVariables["AYWA_INSTALL_DIR"]=installed;start.EnvironmentVariables["AYWA_HEALTH_FILE"]=health;start.EnvironmentVariables["AYWA_SEQUENCE"]=sequence.ToString();
        start.EnvironmentVariables["AYWA_TRIAL"]=trial?"1":"0";start.EnvironmentVariables["AYWA_LAUNCHER"]=LauncherVersion.ToString();
        if(args.Contains("--hidden")&&!showNow)start.Arguments="--hidden";
        using(var process=Process.Start(start)){
          var deadline=DateTime.UtcNow.AddSeconds(180);
          while(!process.HasExited&&!File.Exists(health)&&DateTime.UtcNow<deadline){
            Thread.Sleep(250);
            string early=null;lock(gate){if(pendingShow&&CanForward()){pendingShow=false;early=runningExe;}}if(early!=null)StartShow(early);
          }
          // 건강 확인 전에 42(업데이트 적용)로 끝났으면 실패가 아니다 — 새 버전으로 다시 띄운다.
          if(!File.Exists(health)&&process.HasExited&&process.ExitCode==42){
            // 시험 실행(아직 검증 전)이 다음 버전을 적용했으면 되돌릴 곳은 이 버전이 아니라 그 전의 검증된 버전이다.
            if(trial){try{var next=Read(journal);if(Number(next,"previous",installedSequence)==sequence){next["previous"]=previous;Save(next);}}catch{}}
            attempt=-1;continue;
          }
          // 43 = 본체가 주인 잠금을 못 잡았다(창만 띄우는 실행이 잠깐 쥐었거나 다른 본체가 떠 있다) — 실패로 세지 않고 몇 번 다시 띄운다.
          // 계속 못 잡으면 다른 본체가 앱을 맡고 있는 것이니 되돌리지 않고 끝낸다.
          if(!File.Exists(health)&&process.HasExited&&process.ExitCode==43){if(++lockMisses<=5){Thread.Sleep(2000);attempt=-1;continue;}return;}
          if(!File.Exists(health)){if(!process.HasExited)process.Kill();throw new Exception("health");}
          // 시험 실행 끝을 먼저 쓰고 건강 파일을 지운다 — 본체는 건강 파일이 사라진 뒤에야 업데이트를 적용하므로 이 쓰기가 그 적용을 덮지 않는다.
          if(trial){state["current"]=sequence;state["previous"]=previous;state["trial"]=false;Save(state);}
          File.Delete(health);lockMisses=0;
          string forward=null;lock(gate){runningReady=true;if(pendingShow){pendingShow=false;forward=exe;}}
          if(forward!=null)StartShow(forward);
          process.WaitForExit();
          lock(gate){runningReady=false;runningExe=null;}
          // 42 = 업데이트 적용 — 새 버전을 띄우는 것은 실패가 아니다(세면 세 번째 업데이트부터 새 버전이 안 뜬다, 1.0.7).
          if(process.ExitCode==42){attempt=-1;continue;}
          return;
        }
      }catch{
        if(!trial||previous==sequence){MessageBox.Show("연동 앱을 시작하지 못했습니다. 설치 파일을 다시 실행해 주세요. 기존 설정과 기록은 보관됩니다.","AYWA 연동");return;}
        var failed=state.ContainsKey("failed")?((ArrayList)state["failed"]).Cast<object>().ToList():new List<object>();failed.Add(sequence);
        state["current"]=previous;state["previous"]=installedSequence;state["trial"]=false;state["failed"]=failed;state["rollback"]=true;Save(state);
      }finally{lock(gate){runningReady=false;runningExe=null;}try{if(File.Exists(health))File.Delete(health);}catch{}}
    }
  }
}
