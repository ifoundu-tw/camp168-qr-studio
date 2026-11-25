using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle(Program.DisplayName)]
[assembly: AssemblyProduct(Program.UpdateProductName)]
[assembly: AssemblyCompany("yue")]
[assembly: AssemblyCopyright("by yue")]
[assembly: AssemblyVersion("1.12.0.0")]

internal static class Program
{
    internal const string DisplayName = "美工必備小工具 by yue";
    // Older installers require this exact product name when validating a new binary.
    internal const string UpdateProductName = "CAMP168 QR 工作台";
    private static readonly Assembly Executable = Assembly.GetExecutingAssembly();
    internal static readonly Version CurrentVersion = Executable.GetName().Version;
    internal static readonly string AppData = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Camp168QrStudio");

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibrary(string filename);

    [STAThread]
    private static void Main(string[] args)
    {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        if (args.Length > 0 && args[0] == "--apply-update")
        {
            UpdateService.RunInstaller(args);
            return;
        }
        if (args.Length == 2 && args[0] == "--clean-update") UpdateService.CleanPreviousHelper(args[1]);

        AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs assemblyArgs)
        {
            var name = new AssemblyName(assemblyArgs.Name).Name;
            if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
            return Assembly.Load(ReadResource("sdk." + name + ".dll"));
        };

        try
        {
            LoadEmbeddedNativeLibrary();
            Run();
        }
        catch (Exception error)
        {
            MessageBox.Show("無法啟動程式。\n\n" + error.GetBaseException().Message,
                DisplayName, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static void LoadEmbeddedNativeLibrary()
    {
        byte[] bytes = ReadResource("sdk.WebView2Loader.dll");
        string signature;
        using (var sha = SHA256.Create())
            signature = BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "");
        string directory = Path.Combine(AppData, "Runtime", signature);
        Directory.CreateDirectory(directory);
        string filename = Path.Combine(directory, "WebView2Loader.dll");
        if (!File.Exists(filename))
        {
            string temporary = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                File.WriteAllBytes(temporary, bytes);
                try { File.Move(temporary, filename); }
                catch (IOException) { if (!File.Exists(filename)) throw; }
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        if (!File.ReadAllBytes(filename).SequenceEqual(bytes))
            throw new IOException("WebView2 啟動元件與 EXE 不相符。");
        if (LoadLibrary(filename) == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void Run()
    {
        using (var form = new StudioForm()) Application.Run(form);
    }

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr context);

    internal static Stream OpenResource(string name)
    {
        return Executable.GetManifestResourceStream(name);
    }

    private static byte[] ReadResource(string name)
    {
        using (var source = OpenResource(name))
        using (var target = new MemoryStream())
        {
            if (source == null) throw new IOException("缺少啟動元件 " + name);
            source.CopyTo(target);
            return target.ToArray();
        }
    }
}

internal sealed partial class StudioForm : Form
{
    private const string Origin = "https://camp168-qr.local/";
    private readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill };
    private readonly Label loading = new Label {
        Dock = DockStyle.Fill, Text = "正在啟動美工必備小工具…", TextAlign = ContentAlignment.MiddleCenter
    };
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
    private string exportFolder;
    private bool checkedUpdate;

    public StudioForm()
    {
        Text = Program.DisplayName + "  v" + Program.CurrentVersion.ToString(3);
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(370, 410);
        ClientSize = new Size(1000, 720);
        AutoScaleMode = AutoScaleMode.Dpi;
        Controls.Add(view);
        Controls.Add(loading);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        try
        {
            CoreWebView2Environment environment;
            try
            {
                environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.AppData, "WebView"));
            }
            catch (WebView2RuntimeNotFoundException)
            {
                throw new InvalidOperationException("這台電腦缺少 Microsoft Edge WebView2 Runtime。請先安裝後再開啟。");
            }
            await view.EnsureCoreWebView2Async(environment);
            var web = view.CoreWebView2;
            web.Settings.AreDevToolsEnabled = false;
            web.Settings.AreDefaultContextMenusEnabled = false;
            web.Settings.AreBrowserAcceleratorKeysEnabled = false;
            web.Settings.IsStatusBarEnabled = false;

            web.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            FormClosed += delegate { ClearConversionUpload(); };
            web.WebResourceRequested += delegate(object sender, CoreWebView2WebResourceRequestedEventArgs eventArgs)
            {
                var url = new Uri(eventArgs.Request.Uri);
                if (url.Scheme != Uri.UriSchemeHttps && url.Scheme != Uri.UriSchemeHttp) return;
                var path = url.AbsolutePath;
                string mime = ContentType(path);
                Stream stream = null;
                bool conversionSource = path.StartsWith("/convert-image/",StringComparison.Ordinal);
                if (IsAppUri(url) && conversionSource)
                {
                    mime = "application/octet-stream";
                    if (eventArgs.Request.Method == "GET")
                        stream = OpenConversionImage(path.Substring("/convert-image/".Length));
                }
                else if (IsAppUri(url))
                    stream = path.StartsWith("/tool-image/",StringComparison.Ordinal)
                        ? OpenToolImage(path.Substring("/tool-image/".Length),out mime)
                        : Program.OpenResource("ui" + path);
                if (stream == null)
                {
                    eventArgs.Response = environment.CreateWebResourceResponse(null, 404, "Not Found", "");
                    return;
                }
                eventArgs.Response = environment.CreateWebResourceResponse(stream, 200, "OK",
                    "Content-Type: " + mime + "\r\nX-Content-Type-Options: nosniff" +
                    (conversionSource ? "\r\nContent-Disposition: attachment\r\nCache-Control: no-store" : ""));
            };
            web.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs eventArgs)
            {
                Uri uri;
                eventArgs.Cancel = !Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out uri) || !IsAppUri(uri);
            };
            web.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs eventArgs)
            {
                eventArgs.Handled = true;
                Uri uri;
                if (!eventArgs.IsUserInitiated || !Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out uri)) return;
                if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) return;
                try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
                catch (System.ComponentModel.Win32Exception) { }
            };
            web.WebMessageReceived += OnMessage;
            web.NavigationCompleted += async delegate(object sender, CoreWebView2NavigationCompletedEventArgs eventArgs)
            {
                loading.Visible = false;
                if (!eventArgs.IsSuccess || checkedUpdate) return;
                checkedUpdate = true;
                await CheckForUpdateAsync();
            };
            await web.AddScriptToExecuteOnDocumentCreatedAsync(
                "if(location.origin==='https://camp168-qr.local'){globalThis.camp168SystemFonts=" +
                json.Serialize(SystemFontsList()) + ";globalThis.camp168AppVersion=" +
                json.Serialize(Program.CurrentVersion.ToString(3)) + ";}");
            web.Navigate(Origin + "index.html");
        }
        catch (Exception error)
        {
            MessageBox.Show("無法載入程式。\n\n" + error.GetBaseException().Message, Text,
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private async System.Threading.Tasks.Task CheckForUpdateAsync()
    {
        var release = await UpdateService.CheckAsync(Program.CurrentVersion);
        if (release == null || IsDisposed || !Visible) return;

        string message = "有新版 v" + release.Version.ToString(3) + "。\n目前使用 v" +
            Program.CurrentVersion.ToString(3) + "。";
        message += release.CanInstall
            ? "\n\n更新時工作台會關閉並重新開啟。要立即更新嗎？"
            : "\n\n要開啟 GitHub 發行頁面查看下載嗎？";
        if (MessageBox.Show(this, message, Program.DisplayName + " 更新", MessageBoxButtons.YesNo,
            MessageBoxIcon.Information, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        if (!release.CanInstall)
        {
            UpdateService.OpenReleasePage(release);
            return;
        }
        var title = Text;
        Text = title + "　正在下載更新…";
        UseWaitCursor = true;
        try
        {
            await UpdateService.PrepareAndStartInstallerAsync(release);
            Close();
        }
        catch
        {
            if (!IsDisposed && MessageBox.Show(this,
                "無法完成自動更新。請確認網路連線和目前 EXE 資料夾的寫入權限。\n\n要開啟 GitHub 發行頁面嗎？",
                Program.DisplayName + " 更新", MessageBoxButtons.YesNo, MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2) == DialogResult.Yes)
                UpdateService.OpenReleasePage(release);
        }
        finally
        {
            if (!IsDisposed) { Text = title; UseWaitCursor = false; }
        }
    }

    private static object SystemFontsList()
    {
        var language = System.Windows.Markup.XmlLanguage.GetLanguage("zh-TW");
        return System.Windows.Media.Fonts.SystemFontFamilies
            .Select(font => new {
                family = font.Source,
                label = font.FamilyNames.ContainsKey(language) ? font.FamilyNames[language] : font.Source
            })
            .Where(font => !String.IsNullOrWhiteSpace(font.family) && !font.family.StartsWith("@"))
            .GroupBy(font => font.family, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .OrderBy(font => font.label, StringComparer.Create(CultureInfo.GetCultureInfo("zh-TW"), true))
            .ToArray();
    }

    private static bool IsAppUri(Uri url)
    {
        return url.Scheme == Uri.UriSchemeHttps && url.Host == "camp168-qr.local" && url.IsDefaultPort;
    }

    private static string ContentType(string path)
    {
        switch (Path.GetExtension(path))
        {
            case ".html": return "text/html; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".js": return "text/javascript; charset=utf-8";
            default: return "text/plain; charset=utf-8";
        }
    }

    private async void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        Uri origin;
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out origin) || !IsAppUri(origin)) return;
        int id = 0;
        try
        {
            var message = json.Deserialize<Dictionary<string, object>>(e.TryGetWebMessageAsString());
            id = (int)message["id"];
            object result;
            switch ((string)message["action"])
            {
                case "selectFolder":
                    result = SelectFolder();
                    break;
                case "writeFile":
                    var name = (string)message["name"];
                    var data = (string)message["data"];
                    result = SaveToFolder(name, data);
                    break;
                default:
                    result = await HandleToolMessage(message,e);
                    break;
            }
            Reply(new { id, value = result });
        }
        catch (Exception error)
        {
            if (id != 0)
            {
                var message = error is MomoError ? error.Message : error is UnauthorizedAccessException
                    ? "沒有寫入這個資料夾的權限，請改選其他位置。"
                    : error is IOException
                        ? "無法寫入圖檔，請確認資料夾仍可使用且磁碟有足夠空間。"
                        : "無法完成檔案操作，請重新選擇資料夾後再試。";
                Reply(new { id, error = message });
            }
        }
    }

    private bool SelectFolder()
    {
#if QA
        exportFolder = Environment.GetEnvironmentVariable("CAMP168_QA_EXPORT");
        if (Directory.Exists(exportFolder)) return true;
#endif
        using (var dialog = new FolderBrowserDialog
        {
            Description = "選擇要存放這批 QR Code 圖檔的資料夾",
            ShowNewFolderButton = true,
            SelectedPath = exportFolder ?? ""
        })
        {
            if (dialog.ShowDialog(this) != DialogResult.OK) return false;
            exportFolder = dialog.SelectedPath;
            return true;
        }
    }

    private string SaveToFolder(string name, string data)
    {
        if (String.IsNullOrEmpty(exportFolder)) throw new IOException("請先選擇資料夾。");
        if (!Regex.IsMatch(name, @"\A[A-Za-z0-9_-]{1,190}\.(png|svg)\z", RegexOptions.IgnoreCase))
            throw new IOException("檔名不符合圖檔格式。");
        byte[] bytes = Convert.FromBase64String(data);
        string stem = Path.GetFileNameWithoutExtension(name);
        string extension = Path.GetExtension(name);

        if (Regex.IsMatch(stem, @"\A(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\z", RegexOptions.IgnoreCase))
            stem = "_" + stem;
        for (int index = 1; index <= 10000; index++)
        {
            string candidate = stem + (index == 1 ? "" : "-" + index) + extension;
            string file = Path.Combine(exportFolder, candidate);
            FileStream stream;
            try { stream = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.None); }
            catch (IOException) { if (File.Exists(file) || Directory.Exists(file)) continue; throw; }
            catch (UnauthorizedAccessException) { if (Directory.Exists(file)) continue; throw; }
            try
            {
                using (stream) stream.Write(bytes, 0, bytes.Length);
            }
            catch
            {
                try { File.Delete(file); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                throw;
            }
            return candidate;
        }
        throw new IOException("資料夾內有太多同名圖檔。");
    }

    private void Reply(object response)
    {
        if (!IsDisposed && view.CoreWebView2 != null) view.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
    }
}
