using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("TextMask")]
[assembly: AssemblyDescription("Local text masking and document OCR")]
[assembly: AssemblyCompany("TextMask")]
[assembly: AssemblyProduct("TextMask")]
[assembly: AssemblyVersion("2.0.0.0")]
[assembly: AssemblyFileVersion("2.0.0.0")]

internal static class Launcher
{
    const string Url = "http://127.0.0.1:4175/";
    const string Instance = @"Local\TextMask.Portable.v2";
    static bool quiet;
    static Process server;
    static string startupError = "";

    [STAThread]
    static int Main(string[] args)
    {
        quiet = Array.IndexOf(args, "--background") >= 0;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (args.Length > 1 || (args.Length == 1 && args[0] != "--background" && args[0] != "--stop"))
            return Fail("Неизвестный параметр запуска.", 2);
        if (Array.IndexOf(args, "--stop") >= 0)
        {
            try { using (var signal = EventWaitHandle.OpenExisting(Instance + ".Stop")) { signal.Set(); } return 0; }
            catch (WaitHandleCannotBeOpenedException) { return 0; }
        }
        bool created;
        using (var mutex = new Mutex(true, Instance, out created))
        {
            if (!created)
            {
                try
                {
                    using (var signal = EventWaitHandle.OpenExisting(Instance + ".Open")) { signal.Set(); }
                    return 0;
                }
                catch (WaitHandleCannotBeOpenedException) { return Fail("TextMask уже запускается. Повторите запуск через несколько секунд.", 3); }
            }
            try { return Run(); }
            catch (Exception) { return Fail("Не удалось запустить TextMask. Распакуйте ZIP целиком в доступную для чтения папку и повторите запуск.", 2); }
            finally
            {
                if (server != null)
                {
                    try
                    {
                        if (!server.HasExited)
                        {
                            server.StandardInput.Close();
                            if (!server.WaitForExit(3000)) server.Kill();
                        }
                    }
                    catch (InvalidOperationException) { }
                    finally { server.Dispose(); }
                }
                mutex.ReleaseMutex();
            }
        }
    }

    static int Run()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(root, @"runtime\node.exe");
        string entry = Path.Combine(root, @"app\scripts\portable-server.js");
        if (!File.Exists(node) || !File.Exists(entry))
            return Fail("Не найдены файлы приложения. Сначала распакуйте весь архив TextMask, затем откройте TextMask.exe из распакованной папки.", 2);
        using (var open = new EventWaitHandle(false, EventResetMode.AutoReset, Instance + ".Open"))
        using (var stop = new EventWaitHandle(false, EventResetMode.AutoReset, Instance + ".Stop"))
        using (var ready = new ManualResetEvent(false))
        {
            var start = new ProcessStartInfo(node, "\"" + entry + "\"");
            start.WorkingDirectory = Path.Combine(root, "app");
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            start.RedirectStandardInput = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            // Do not inherit Node injection flags from a developer's shell.
            start.EnvironmentVariables.Remove("NODE_OPTIONS");
            start.EnvironmentVariables.Remove("NODE_PATH");
            server = new Process();
            server.StartInfo = start;
            server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data == "TEXTMASK_READY http://127.0.0.1:4175") ready.Set();
            };
            server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data == "TEXTMASK_PORT_BUSY") startupError = "Порт 4175 занят. Закройте другой экземпляр TextMask или локальный сервер и повторите запуск. Другие приложения не остановлены.";
            };
            server.Start();
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
            for (int i = 0; i < 150 && !ready.WaitOne(100); i++)
                if (server.HasExited) break;
            if (!ready.WaitOne(0) || server.HasExited)
            {
                if (server.HasExited) server.WaitForExit(); // drain redirected diagnostics
                return Fail(startupError.Length > 0 ? startupError : "Локальный сервер не запустился. Проверьте, что архив распакован полностью и приложение не заблокировано Windows.", 4);
            }
            int result = 0;
            using (var tray = new NotifyIcon())
            using (var menu = new ContextMenuStrip())
            using (var timer = new System.Windows.Forms.Timer())
            {
                tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                tray.Text = "TextMask 2.0 — работает на этом компьютере";
                menu.Items.Add("Открыть TextMask", null, delegate { OpenBrowser(); });
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add("Остановить и выйти", null, delegate { Application.ExitThread(); });
                tray.ContextMenuStrip = menu;
                tray.DoubleClick += delegate { OpenBrowser(); };
                tray.Visible = true;
                timer.Interval = 250;
                timer.Tick += delegate
                {
                    if (stop.WaitOne(0)) Application.ExitThread();
                    else if (server.HasExited)
                    {
                        result = Fail("Локальный сервер TextMask остановился. Откройте TextMask.exe, чтобы запустить его снова.", 4);
                        Application.ExitThread();
                    }
                    else if (open.WaitOne(0) && !quiet) OpenBrowser();
                };
                timer.Start();
                if (!quiet) OpenBrowser();
                Application.Run();
                tray.Visible = false;
            }
            return result;
        }
    }

    static void OpenBrowser()
    {
        try { Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true }); }
        catch (Exception) { Fail("Откройте браузер и перейдите по адресу " + Url, 5); }
    }

    static int Fail(string message, int code)
    {
        if (!quiet) MessageBox.Show(message, "TextMask", MessageBoxButtons.OK, MessageBoxIcon.Information);
        return code;
    }
}
