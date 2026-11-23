// The MediaDesk Windows service. install-service.ps1 compiles this file into
// service\MediaDeskService.exe with the C# compiler built into Windows, so nothing is downloaded.
//
// It runs "node supervisor.js" (which runs server.js and applies updates), starts it again if it
// stops, and stops it when the service stops: first by closing its input (MediaDesk then stops
// cleanly and unmounts cloud drives), then, if that takes too long, by ending every process it
// started (a job object), so nothing is left running with old code.
//
// Command line (set by the installer): MediaDeskService.exe "<node.exe>" "<MediaDesk folder>"
// To try it in a window instead: MediaDeskService.exe --console "<node.exe>" "<MediaDesk folder>"
// Written for the C# 5 compiler that comes with Windows PowerShell 5.1.

using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text;
using System.Threading;

namespace MediaDesk
{
    public class MediaDeskService : ServiceBase
    {
        const int ReloadSupervisorCode = 3;   // supervisor.js was updated: start it again at once

        readonly string node;
        readonly string root;
        readonly string logFile;
        Process child;
        Thread loop;
        volatile bool stopping;
        bool console;
        IntPtr job = IntPtr.Zero;
        readonly object gate = new object();

        public MediaDeskService(string node, string root)
        {
            ServiceName = "MediaDesk";
            CanStop = true;
            CanShutdown = true;
            AutoLog = true;
            this.node = node;
            this.root = root.TrimEnd('\\');
            logFile = Path.Combine(Path.Combine(this.root, "logs"), "mediadesk.log");
        }

        public static void Main(string[] args)
        {
            if (args.Length == 3 && args[0] == "--console")
            {
                MediaDeskService s = new MediaDeskService(args[1], args[2]);
                s.console = true;
                s.OnStart(new string[0]);
                Console.WriteLine("MediaDesk is running. Press Enter to stop it.");
                Console.ReadLine();
                s.OnStop();
                return;
            }
            if (args.Length < 2)
            {
                Console.Error.WriteLine("MediaDeskService.exe \"<node.exe>\" \"<MediaDesk folder>\" is started by Windows as a service.");
                Console.Error.WriteLine("Run install-windows.cmd to install it.");
                Environment.Exit(1);
            }
            ServiceBase.Run(new MediaDeskService(args[0], args[1]));
        }

        protected override void OnStart(string[] args)
        {
            job = CreateKillOnCloseJob();
            loop = new Thread(Run);
            loop.IsBackground = true;
            loop.Start();
        }

        protected override void OnStop() { StopChild(); }

        protected override void OnShutdown() { StopChild(); }

        void Run()
        {
            int quickStops = 0;
            while (!stopping)
            {
                DateTime started = DateTime.UtcNow;
                int code = RunSupervisor();
                if (stopping) break;
                if (code == ReloadSupervisorCode)
                {
                    Log("starting the updated supervisor");
                    continue;
                }
                quickStops = (DateTime.UtcNow - started).TotalMinutes < 2 ? quickStops + 1 : 0;
                int wait = Math.Min(60, 5 * Math.Max(1, quickStops));
                Log(string.Format("the supervisor stopped (exit code {0}); starting it again in {1} s", code, wait));
                for (int i = 0; i < wait * 10 && !stopping; i++) Thread.Sleep(100);
            }
        }

        int RunSupervisor()
        {
            ProcessStartInfo psi = new ProcessStartInfo(node,
                Quote(Path.Combine(root, "supervisor.js")) + " --stdin-stop --log " + Quote(logFile));
            psi.WorkingDirectory = root;
            psi.UseShellExecute = false;
            psi.RedirectStandardInput = true;
            psi.CreateNoWindow = true;
            Process p;
            try
            {
                lock (gate)
                {
                    if (stopping) return 0;
                    p = Process.Start(psi);
                    child = p;
                    if (job != IntPtr.Zero) AssignProcessToJobObject(job, p.Handle);
                }
            }
            catch (Exception e)
            {
                Log("could not start Node.js (" + node + "): " + e.Message);
                return -1;
            }
            p.WaitForExit();
            return p.ExitCode;
        }

        void StopChild()
        {
            stopping = true;
            if (!console) RequestAdditionalTime(25000);
            Process p;
            lock (gate) { p = child; }
            if (p != null)
            {
                try
                {
                    if (!p.HasExited)
                    {
                        try { p.StandardInput.Close(); } catch (Exception) { }
                        if (!p.WaitForExit(20000))
                        {
                            Log("MediaDesk didn't stop within 20 seconds; ending it");
                            try { p.Kill(); } catch (Exception) { }
                        }
                    }
                }
                catch (Exception) { }
            }
            // Ends anything still running that MediaDesk started (the server, rclone, ffmpeg...).
            if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
        }

        static string Quote(string s) { return "\"" + s + "\""; }

        void Log(string message)
        {
            string line = "[" + DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ") + "] Service: " + message + Environment.NewLine;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(logFile));
                using (FileStream fs = new FileStream(logFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete))
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(line);
                    fs.Write(bytes, 0, bytes.Length);
                }
            }
            catch (Exception)
            {
                try { EventLog.WriteEntry("MediaDesk", message, EventLogEntryType.Warning); } catch (Exception) { }
            }
        }

        // ---- A job object that ends every process in it when the service lets go of it ----

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        const int JobObjectExtendedLimitInformation = 9;
        const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr handle);

        IntPtr CreateKillOnCloseJob()
        {
            IntPtr h;
            try { h = CreateJobObject(IntPtr.Zero, null); }
            catch (Exception) { return IntPtr.Zero; }
            if (h == IntPtr.Zero) return IntPtr.Zero;
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr ptr = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(info, ptr, false);
                if (!SetInformationJobObject(h, JobObjectExtendedLimitInformation, ptr, (uint)size))
                {
                    CloseHandle(h);
                    return IntPtr.Zero;
                }
            }
            finally { Marshal.FreeHGlobal(ptr); }
            return h;
        }
    }
}
