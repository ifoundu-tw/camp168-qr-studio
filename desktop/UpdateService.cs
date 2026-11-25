using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class UpdateService
{
    private const string Repository = "ifoundu-tw/camp168-qr-studio";
    private const string LatestApi = "https://api.github.com/repos/" + Repository + "/releases/latest";
    private const string Releases = "https://github.com/" + Repository + "/releases/";
    private const string EventPrefix = @"Local\Camp168QrUpdate-";
    private const long MaximumAsset = 128L * 1024 * 1024;
    private static readonly Regex ReleaseTag = new Regex(@"\Av[0-9]+\.[0-9]+\.[0-9]+\z", RegexOptions.CultureInvariant);
    private static readonly Regex HashPattern = new Regex(@"\A[0-9a-f]{64}\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly string Updates = Path.Combine(Path.GetTempPath(), "Camp168QrStudio.Updates");

    internal sealed class Release
    {
        internal Version Version;
        internal string Tag;
        internal string Download;
        internal string Hash;
        internal long Size;
        internal bool CanInstall { get { return Download != null; } }
    }

    public sealed class ReleaseJson
    {
        public string tag_name { get; set; }
        public bool draft { get; set; }
        public bool prerelease { get; set; }
        public AssetJson[] assets { get; set; }
    }

    public sealed class AssetJson
    {
        public string name { get; set; }
        public string state { get; set; }
        public string browser_download_url { get; set; }
        public string digest { get; set; }
        public long size { get; set; }
    }

    private static HttpClient NewClient()
    {
        var client = new HttpClient();
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Camp168QrStudio/" + Program.CurrentVersion.ToString(3));
        return client;
    }

    internal static async Task<Release> CheckAsync(Version current)
    {
        try
        {
            using (var client = NewClient())
            {
                client.Timeout = TimeSpan.FromSeconds(8);
                client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
                string body = await client.GetStringAsync(LatestApi).ConfigureAwait(false);
                return ParseRelease(body,current);
            }
        }
        catch { return null; }
    }

    internal static Release ParseRelease(string body, Version current)
    {
        var data = new JavaScriptSerializer().Deserialize<ReleaseJson>(body);
        Version latest;
        if (data == null || data.draft || data.prerelease || !TryReleaseTag(data.tag_name,out latest) ||
            latest <= ThreeParts(current)) return null;
        var release = new Release { Version = latest, Tag = data.tag_name };
        if (data.assets == null) return release;
        foreach (var asset in data.assets)
        {
            if (asset == null) continue;
            var expectedName = "CAMP168-QR-" + latest.ToString(3) + ".exe";
            if ((asset.name != expectedName && asset.name != "CAMP168-QR.exe") ||
                asset.state != "uploaded" || asset.size <= 0 || asset.size > MaximumAsset ||
                asset.browser_download_url != Releases + "download/" + release.Tag + "/" + asset.name ||
                String.IsNullOrEmpty(asset.digest) || !asset.digest.StartsWith("sha256:",StringComparison.OrdinalIgnoreCase))
                continue;
            string hash = asset.digest.Substring(7);
            if (!HashPattern.IsMatch(hash)) continue;
            release.Download = asset.browser_download_url;
            release.Hash = hash;
            release.Size = asset.size;
            break;
        }
        return release;
    }

    private static Version ThreeParts(Version value)
    {
        return new Version(value.Major,value.Minor,Math.Max(0,value.Build));
    }

    private static bool TryReleaseTag(string tag, out Version version)
    {
        version = null;
        return tag != null && ReleaseTag.IsMatch(tag) && Version.TryParse(tag.Substring(1),out version);
    }

    internal static void OpenReleasePage(Release release)
    {
        try
        {
            using (Process.Start(new ProcessStartInfo(Releases + "tag/" + release.Tag) { UseShellExecute = true })) { }
        }
        catch (System.ComponentModel.Win32Exception)
        {
            MessageBox.Show("無法開啟瀏覽器。請到 GitHub 發行頁面下載。",
                Program.DisplayName + " 更新",MessageBoxButtons.OK,MessageBoxIcon.Information);
        }
    }

    internal static async Task PrepareAndStartInstallerAsync(Release release)
    {
        string id = Guid.NewGuid().ToString("N");
        string folder = Path.Combine(Updates,id);
        Directory.CreateDirectory(folder);
        string payload = Path.Combine(folder,"payload.exe");
        string helper = Path.Combine(folder,"apply.exe");
        Process worker = null;
        bool handedOff = false;
        try
        {
            using (var client = NewClient())
            using (var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(2)))
            using (var response = await client.GetAsync(release.Download,HttpCompletionOption.ResponseHeadersRead,timeout.Token)
                .ConfigureAwait(false))
            {
                response.EnsureSuccessStatusCode();
                using (var incoming = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                using (var saved = new FileStream(payload,FileMode.CreateNew,FileAccess.Write,FileShare.None,65536,true))
                {
                    byte[] chunk = new byte[65536];
                    long length = 0;
                    int count;
                    while ((count = await incoming.ReadAsync(chunk,0,chunk.Length,timeout.Token).ConfigureAwait(false)) > 0)
                    {
                        length += count;
                        if (length > release.Size) throw new IOException("更新檔大小不相符。");
                        await saved.WriteAsync(chunk,0,count,timeout.Token).ConfigureAwait(false);
                    }
                    if (length != release.Size) throw new IOException("更新檔大小不相符。");
                }
            }

            ValidateBinary(payload,release.Hash,release.Version);
            string target = Assembly.GetExecutingAssembly().Location;
            File.Copy(target,helper);
            using (var parent = Process.GetCurrentProcess())
            using (var ready = new EventWaitHandle(false,EventResetMode.ManualReset,EventPrefix+id))
            {
                var command = "--apply-update " + id + " " + parent.Id + " " +
                    parent.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture) + " \"" +
                    target + "\" " + release.Tag + " " + release.Hash;
                worker = Process.Start(new ProcessStartInfo(helper,command) {
                    UseShellExecute = false, WorkingDirectory = folder
                });
                if (worker == null || !await Task.Run(() => ready.WaitOne(TimeSpan.FromSeconds(6))).ConfigureAwait(false))
                    throw new IOException("無法啟動更新程序。");
                handedOff = true;
            }
        }
        finally
        {
            if (!handedOff)
            {
                if (worker != null) try { if (!worker.HasExited) worker.Kill(); } catch (InvalidOperationException) { }
                DeleteUpdateFiles(folder);
            }
            if (worker != null) worker.Dispose();
        }
    }

    internal static void RunInstaller(string[] args)
    {
        bool acknowledged = false;
        try
        {
            Guid id;
            int pid;
            long started;
            Version version;
            if (args.Length != 7 || !Guid.TryParseExact(args[1],"N",out id) ||
                !Int32.TryParse(args[2],out pid) || !Int64.TryParse(args[3],out started) ||
                !TryReleaseTag(args[5],out version) || version <= ThreeParts(Program.CurrentVersion) ||
                !HashPattern.IsMatch(args[6])) return;
            string folder = Path.Combine(Updates,id.ToString("N"));
            string target = Path.GetFullPath(args[4]);
            string payload = Path.Combine(folder,"payload.exe");
            using (var parent = Process.GetProcessById(pid))
            {
                string runningPath = parent.MainModule.FileName;
                if (!String.Equals(target,runningPath,StringComparison.OrdinalIgnoreCase) ||
                    parent.StartTime.ToUniversalTime().Ticks != started ||
                    FileVersionInfo.GetVersionInfo(target).ProductName != Program.UpdateProductName) return;

                ValidateBinary(payload,args[6],version);
                using (var ready = EventWaitHandle.OpenExisting(EventPrefix+id.ToString("N"))) ready.Set();
                acknowledged = true;
                if (!parent.WaitForExit(30000)) throw new IOException("原程式仍在執行。");
            }

            InstallAndRestart(target,payload,args[6],version,id);
        }
        catch
        {
            if (acknowledged)
                MessageBox.Show("無法替換程式，請確認所有工作台視窗已關閉，且 EXE 所在資料夾可寫入。",
                    Program.DisplayName + " 更新",MessageBoxButtons.OK,MessageBoxIcon.Warning);
        }
    }

    private static void InstallAndRestart(string target,string payload,string hash,Version version,Guid id)
    {
        string directory = Path.GetDirectoryName(target);
        string stagingFile = Path.Combine(directory,".camp168-update-"+id.ToString("N")+".exe");
        string backup = Path.Combine(directory,".camp168-previous-"+id.ToString("N")+".exe");
        try
        {
            File.Copy(payload,stagingFile);
            ValidateBinary(stagingFile,hash,version);
            File.Replace(stagingFile,target,backup);
            try
            {
                using (var app = Process.Start(new ProcessStartInfo(target,"--clean-update "+id.ToString("N")) {
                    UseShellExecute = false, WorkingDirectory = directory
                }))
                {
                    if (app == null || app.WaitForExit(1500)) throw new IOException("新版程式未能正常啟動。");
                }
            }
            catch
            {
                File.Replace(backup,target,null);
                try { using (Process.Start(new ProcessStartInfo(target) { UseShellExecute = false, WorkingDirectory = directory })) { } }
                catch (System.ComponentModel.Win32Exception) { }
                throw;
            }
            TryDelete(backup);
        }
        finally { TryDelete(stagingFile); }
    }

    private static void ValidateBinary(string file,string hash,Version version)
    {
        string actual;
        using (var sha = SHA256.Create())
        using (var stream = File.OpenRead(file))
            actual = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","");
        var info = FileVersionInfo.GetVersionInfo(file);
        var actualVersion = new Version(info.FileMajorPart,info.FileMinorPart,info.FileBuildPart);
        if (!String.Equals(hash,actual,StringComparison.OrdinalIgnoreCase) ||
            info.ProductName != Program.UpdateProductName || actualVersion != version)
            throw new IOException("更新檔未通過完整性或版號檢查。");
    }

    internal static void CleanPreviousHelper(string id)
    {
        Guid folderId;
        if (!Guid.TryParseExact(id,"N",out folderId)) return;
        string folder = Path.Combine(Updates,folderId.ToString("N"));
        Task.Run(async delegate
        {
            for (int attempt = 0; attempt < 12 && Directory.Exists(folder); attempt++)
            {
                await Task.Delay(400).ConfigureAwait(false);
                DeleteUpdateFiles(folder);
            }
        });
    }

    private static void DeleteUpdateFiles(string folder)
    {
        TryDelete(Path.Combine(folder,"apply.exe"));
        TryDelete(Path.Combine(folder,"payload.exe"));
        try { Directory.Delete(folder); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private static void TryDelete(string file)
    {
        try { File.Delete(file); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}
