// 현장 PC(2026-10-15 재설치 · 1.0.5)에 깔린 옛 실행기 원본 = git fb0ef21a8:apps/sync-agent/native/Bootstrap.cs (1.0.7 4461dcc15 전 마지막 판).
// 1.0.12 넘겨받기 시험의 "앞 실행기"로만 쓴다 — 고치지 말 것(현장 코드 그대로여야 시험이 뜻을 가진다).
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
  const int InstalledSequence = __SEQUENCE__;
  static JavaScriptSerializer json=new JavaScriptSerializer {MaxJsonLength=8*1024*1024};
  static string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"AYWA","Sync");
  static string installed=AppDomain.CurrentDomain.BaseDirectory;
  static string journal=Path.Combine(root,"launch.json");
  static Dictionary<string,object> Read(string file){return json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file,Encoding.UTF8));}
  static int Number(Dictionary<string,object> d,string key,int fallback){object v;return d.TryGetValue(key,out v)?Convert.ToInt32(v):fallback;}
  static void Save(Dictionary<string,object> d){string temp=journal+".bootstrap";File.WriteAllText(temp,json.Serialize(d),new UTF8Encoding(false));if(File.Exists(journal))File.Replace(temp,journal,null);else File.Move(temp,journal);}
  static string ValidatedRuntime(int sequence) {
    if(sequence==InstalledSequence)return Path.Combine(installed,"AywaSyncRuntime.exe");
    if(sequence<InstalledSequence)throw new Exception("version");
    string dir=Path.Combine(root,"versions",sequence.ToString());var envelope=Read(Path.Combine(dir,"release.json"));
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
  [STAThread] static void Main(string[] args){
    Directory.CreateDirectory(root);
    // Electron is the single-instance authority. A second bootstrap only asks the running app to show.
    bool owner;using(var mutex=new Mutex(true,"Local\\AYWA.Sync.Bootstrap",out owner)){
      if(!owner){try{Process.Start(new ProcessStartInfo(Path.Combine(installed,"AywaSyncRuntime.exe")){UseShellExecute=false});}catch{}return;}
      for(int attempt=0;attempt<3;attempt++){
        Dictionary<string,object> state;try{state=Read(journal);}catch{state=new Dictionary<string,object>();}
        int sequence=InstalledSequence,previous=InstalledSequence;bool trial=false;
        try{sequence=Number(state,"current",InstalledSequence);previous=Number(state,"previous",InstalledSequence);trial=state.ContainsKey("trial")&&(bool)state["trial"];}catch{state=new Dictionary<string,object>();sequence=InstalledSequence;previous=InstalledSequence;}
        if(sequence<InstalledSequence){sequence=InstalledSequence;previous=InstalledSequence;trial=false;}
        string health=Path.Combine(root,"health-"+Guid.NewGuid().ToString("N"));
        try {
          string exe=ValidatedRuntime(sequence);
          var start=new ProcessStartInfo(exe){UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(exe)};
          start.EnvironmentVariables["AYWA_INSTALL_DIR"]=installed;start.EnvironmentVariables["AYWA_HEALTH_FILE"]=health;start.EnvironmentVariables["AYWA_SEQUENCE"]=sequence.ToString();
          start.EnvironmentVariables["AYWA_TRIAL"]=trial?"1":"0";
          if(args.Contains("--hidden"))start.Arguments="--hidden";
          using(var process=Process.Start(start)){
            var deadline=DateTime.UtcNow.AddSeconds(180);
            while(!process.HasExited&&!File.Exists(health)&&DateTime.UtcNow<deadline)Thread.Sleep(250);
            if(!File.Exists(health)){if(!process.HasExited)process.Kill();throw new Exception("health");}
            File.Delete(health);
            if(trial){state["current"]=sequence;state["previous"]=previous;state["trial"]=false;Save(state);}
            process.WaitForExit();
            if(process.ExitCode==42)continue;
            return;
          }
        }catch{
          if(!trial||previous==sequence){MessageBox.Show("연동 앱을 시작하지 못했습니다. 설치 파일을 다시 실행해 주세요. 기존 설정과 기록은 보관됩니다.","AYWA 연동");return;}
          var failed=state.ContainsKey("failed")?((ArrayList)state["failed"]).Cast<object>().ToList():new List<object>();failed.Add(sequence);
          state["current"]=previous;state["previous"]=InstalledSequence;state["trial"]=false;state["failed"]=failed;state["rollback"]=true;Save(state);
        }finally{try{if(File.Exists(health))File.Delete(health);}catch{}}
      }
    }
  }
}
