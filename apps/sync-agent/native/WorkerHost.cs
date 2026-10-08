using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// A separate native process owns the entire worker tree. Closing stdin kills the job,
// even when Electron is killed or a worker's JS thread is blocked in spawnSync.
class WorkerHost {
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS {public ulong a,b,c,d,e,f;}
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT {public long a,b;public uint flags;public UIntPtr min,max;public uint active;public UIntPtr affinity;public uint priority,scheduling;}
  [StructLayout(LayoutKind.Sequential)] struct EXT_LIMIT {public BASIC_LIMIT basic;public IO_COUNTERS io;public UIntPtr process,job,peakProcess,peakJob;}
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUPINFO {public int cb;public string reserved,desktop,title;public uint x,y,xSize,ySize,xChars,yChars,fill,flags;public short show,reserved2;public IntPtr reservedPtr,input,output,error;}
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION {public IntPtr process,thread;public uint processId,threadId;}
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attr,string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXT_LIMIT info,uint size);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO si,out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int h);
  static string Quote(string v) {
    var b=new StringBuilder("\"");int n=0;
    foreach(char c in v){if(c=='\\'){n++;continue;}if(c=='"'){b.Append('\\',n*2+1);b.Append(c);}else{b.Append('\\',n);b.Append(c);}n=0;}
    b.Append('\\',n*2);b.Append('"');return b.ToString();
  }
  static int Main(string[] args) {
    if(args.Length<2)return 64;
    IntPtr job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)return 70;
    var info=new EXT_LIMIT();info.basic.flags=0x2000;
    if(!SetInformationJobObject(job,9,ref info,(uint)Marshal.SizeOf(info))){CloseHandle(job);return 71;}
    var si=new STARTUPINFO();si.cb=Marshal.SizeOf(si);si.flags=0x100;si.input=GetStdHandle(-10);si.output=GetStdHandle(-11);si.error=GetStdHandle(-12);
    var command=new StringBuilder();foreach(var arg in args)command.Append(Quote(arg)).Append(' ');
    PROCESS_INFORMATION pi;
    if(!CreateProcess(args[0],command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,Environment.CurrentDirectory,ref si,out pi)){CloseHandle(job);return 72;}
    if(!AssignProcessToJobObject(job,pi.process)){TerminateProcess(pi.process,73);CloseHandle(job);return 73;}
    ResumeThread(pi.thread);CloseHandle(pi.thread);
    var monitor=new Thread(()=>{try{while(Console.ReadLine()!=null){}}catch{}CloseHandle(job);Environment.Exit(74);});monitor.IsBackground=true;monitor.Start();
    WaitForSingleObject(pi.process,0xffffffff);uint code;GetExitCodeProcess(pi.process,out code);CloseHandle(pi.process);CloseHandle(job);return (int)code;
  }
}
