using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

// JARVIS launcher: sobe o servidor Next e abre a janela do app.
// Compilado como executavel Windows nativo (sem console), icone embutido.
internal static class Program
{
    private const int Port = 3001;
    private const string Url = "http://127.0.0.1:3001";

    [STAThread]
    private static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        try
        {
            if (ServerIsUp())
            {
                OpenWindow(root);
                return 0;
            }

            string marker = Path.Combine(root, "data", "no-electron");
            string buildId = Path.Combine(root, ".next", "BUILD_ID");
            string mode = File.Exists(buildId) ? "start" : "dev";

            if (!StartServer(root, mode))
            {
                OpenBrowser();
                return 1;
            }

            for (int i = 0; i < 150; i++)
            {
                Thread.Sleep(1000);
                if (ServerIsUp())
                {
                    OpenWindow(root);
                    return 0;
                }
            }

            OpenBrowser();
            return 1;
        }
        catch (Exception error)
        {
            TryWriteLog(root, error.ToString());
            OpenBrowser();
            return 1;
        }
    }

    private static bool ServerIsUp()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Url);
            request.Timeout = 1500;
            request.Proxy = null;
            request.AllowAutoRedirect = false;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                return (int)response.StatusCode < 500;
            }
        }
        catch
        {
            return false;
        }
    }

    private static bool StartServer(string root, string mode)
    {
        string npm = @"C:\Program Files\nodejs\npm.cmd";
        if (!File.Exists(npm)) npm = "npm.cmd";

        ProcessStartInfo info = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/c \"\"" + npm + "\" run " + mode + "\"",
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        try
        {
            Process.Start(info);
            return true;
        }
        catch (Exception error)
        {
            TryWriteLog(root, "falha ao iniciar o servidor: " + error.Message);
            return false;
        }
    }

    private static void OpenWindow(string root)
    {
        string marker = Path.Combine(root, "data", "no-electron");
        string electron = Path.Combine(root, "node_modules", "electron", "dist", "electron.exe");

        if (File.Exists(electron) && !File.Exists(marker))
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = electron,
                    Arguments = "\"" + root + "\"",
                    WorkingDirectory = root,
                    UseShellExecute = true,
                });
                Thread.Sleep(11000);

                if (Process.GetProcessesByName("electron").Length > 0) return;

                Directory.CreateDirectory(Path.GetDirectoryName(marker));
                File.WriteAllText(marker, "electron bloqueado neste Windows");
            }
            catch
            {
                // segue para a janela do Edge
            }
        }

        string edge = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
        if (File.Exists(edge))
        {
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "JARVIS", "window");
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = edge,
                    Arguments = "--app=" + Url + " --window-size=1440,900 --user-data-dir=\"" + profile + "\"",
                    UseShellExecute = false,
                });
                return;
            }
            catch
            {
                // segue para o navegador padrao
            }
        }

        OpenBrowser();
    }

    private static void OpenBrowser()
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = Url, UseShellExecute = true });
        }
        catch
        {
        }
    }

    private static void TryWriteLog(string root, string message)
    {
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "data", "logs"));
            File.AppendAllText(
                Path.Combine(root, "data", "logs", "launcher.log"),
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine
            );
        }
        catch
        {
        }
    }
}
