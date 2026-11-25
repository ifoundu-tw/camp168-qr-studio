using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

internal sealed partial class StudioForm
{
    private readonly Dictionary<string,string> toolPaths = new Dictionary<string,string>(StringComparer.Ordinal);
    private readonly Dictionary<string,string> toolIds = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string,byte[]> renameStaged = new Dictionary<string,byte[]>(StringComparer.OrdinalIgnoreCase);
    private string momoFolder, renameFolder, splitFolder;
    private string[] momoResultFolders = new string[0], renameResultFolders = new string[0], splitResultFolders = new string[0];
    private CancellationTokenSource momoCancellation, splitCancellation;
    private bool renaming;

    private async Task<object> HandleToolMessage(Dictionary<string,object> message,CoreWebView2WebMessageReceivedEventArgs e)
    {
        string action = (string)message["action"];
        string tool = message.ContainsKey("tool") ? (string)message["tool"] : "";
        switch (action)
        {
            case "toolPick": return AddToolFiles(PickToolFiles(tool),tool);
            case "toolDrop": return AddToolFiles(e.AdditionalObjects.OfType<CoreWebView2File>().Select(f=>f.Path),tool);
            case "toolFolder": return ChooseToolFolder(tool);
            case "toolOpen":
                var folders = tool == "momo" ? momoResultFolders : tool == "split" ? splitResultFolders :
                    tool == "convert" ? convertResultFolders : renameResultFolders;
                int index = message.ContainsKey("index") ? Convert.ToInt32(message["index"],CultureInfo.InvariantCulture) : 0;
                if (index < 0 || index >= folders.Length || !Directory.Exists(folders[index]))
                    throw new MomoError("找不到這個輸出資料夾。");
                using (Process.Start(new ProcessStartInfo(folders[index]) { UseShellExecute = true })) { }
                return true;
            case "momoRun": return await RunMomo(message);
            case "momoCancel":
                if (momoCancellation != null) momoCancellation.Cancel();
                return true;
            case "splitPreview":
                string source;
                if (!toolPaths.TryGetValue((string)message["file"],out source))
                    throw new MomoError("找不到來源圖片。");
                return await Task.Run(()=>ImageSplit.Preview(source));
            case "splitPlan":
                return ImageSplit.Layout(ToolInt(message,"width"),ToolInt(message,"height"),
                    (string)message["mode"],ToolInt(message,"first"),ToolInt(message,"second"));
            case "splitRun": return await RunSplit(message);
            case "convertReset":
                ClearConversionUpload();
                convertResultFolders = new string[0];
                return true;
            case "convertFile": case "convertBegin": case "convertChunk": case "convertFinish": case "convertAbort":
                return await HandleConversion(action,message);
            case "splitCancel":
                if (splitCancellation != null) splitCancellation.Cancel();
                return true;
            case "renameClearStage":
                if (!renaming) renameStaged.Clear();
                return true;
            case "renameStage":
                if (renaming) throw new MomoError("上一個批次仍在執行。");
                string path;
                if (!toolPaths.TryGetValue((string)message["file"],out path) ||
                    !Path.GetExtension(path).Equals(".webp",StringComparison.OrdinalIgnoreCase))
                    throw new MomoError("找不到這張 WebP 圖片。");
                renameStaged[path] = Convert.FromBase64String((string)message["data"]);
                return true;
            case "renameRun": return await RunRename(message);
            default: throw new MomoError("無法辨識此操作。");
        }
    }

    private string[] PickToolFiles(string tool)
    {
#if QA
        string fixture = Environment.GetEnvironmentVariable(tool == "momo" ? "CAMP168_QA_MOMO" :
            tool == "split" ? "CAMP168_QA_SPLIT" : tool == "convert" ? "CAMP168_QA_CONVERT" : "CAMP168_QA_RENAME");
        if (!String.IsNullOrEmpty(fixture)) return fixture.Split('|');
#endif
        using (var picker = new OpenFileDialog {
            Title = tool == "momo" || tool == "convert" ? "選擇要轉換的圖片" :
                tool == "split" ? "選擇要拆分的圖片" : "選擇要重新命名的檔案",
            Multiselect = true, CheckFileExists = true,
            Filter = tool == "momo"
                ? "支援的圖片|*.jpg;*.jpeg;*.png;*.bmp;*.tif;*.tiff;*.ai;*.psd|所有檔案|*.*"
                : tool == "split" ? "支援的圖片|"+ImageSplit.Extensions : "所有檔案|*.*"
        }) return picker.ShowDialog(this) == DialogResult.OK ? picker.FileNames : new string[0];
    }

    private object AddToolFiles(IEnumerable<string> paths,string tool)
    {
        var items = new List<object>();
        int skipped = 0;
        foreach (string path in paths.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (String.IsNullOrEmpty(path) || !Path.IsPathRooted(path) || !File.Exists(path) ||
                (tool == "momo" && !MomoBatch.Supports(path)) || (tool == "split" && !ImageSplit.Supports(path)))
            {
                skipped++;
                continue;
            }
            string id;
            if (!toolIds.TryGetValue(path,out id))
            {
                id = Guid.NewGuid().ToString("N");
                toolIds.Add(path,id);
                toolPaths.Add(id,path);
            }
            if (tool == "convert") converterIds.Add(id);
            items.Add(new { id, name = Path.GetFileName(path), extension = Path.GetExtension(path),
                thumbnail = ThumbnailMime(path) != null || HasNativeThumbnail(path) });
        }
        return new { items, skipped };
    }

    private string ChooseToolFolder(string tool)
    {
        string current = tool == "momo" ? momoFolder : tool == "split" ? splitFolder :
            tool == "convert" ? convertFolder : renameFolder;
        string chosen = null;
#if QA
        chosen = Environment.GetEnvironmentVariable(tool == "momo" ? "CAMP168_QA_MOMO_EXPORT" :
            tool == "split" ? "CAMP168_QA_SPLIT_EXPORT" : tool == "convert" ? "CAMP168_QA_CONVERT_EXPORT" : "CAMP168_QA_RENAME_EXPORT");
#endif
        if (String.IsNullOrEmpty(chosen))
        {
            using (var dialog = new FolderBrowserDialog {
                Description = "選擇輸出資料夾", ShowNewFolderButton = true, SelectedPath = current ?? ""
            })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return null;
                chosen = dialog.SelectedPath;
            }
        }
        if (tool == "momo") momoFolder = chosen;
        else if (tool == "split") splitFolder = chosen;
        else if (tool == "convert") convertFolder = chosen;
        else renameFolder = chosen;
        return chosen;
    }

    private string[] MessageFiles(Dictionary<string,object> message)
    {
        var ids = message["ids"] as System.Collections.IEnumerable;
        if (ids == null) throw new MomoError("請先加入檔案。");
        string[] files = ids.Cast<object>().Select(id=>{
            string path;
            if (!toolPaths.TryGetValue(id as string ?? "",out path)) throw new MomoError("有來源檔案已離開清單。");
            return path;
        }).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (files.Length == 0) throw new MomoError("請先加入檔案。");
        return files;
    }

    private async Task<object> RunMomo(Dictionary<string,object> message)
    {
        if (momoCancellation != null || splitCancellation != null || renaming || converting) throw new MomoError("另一個批次仍在執行。");
        string[] files = MessageFiles(message);
        if (files.Any(path=>!MomoBatch.Supports(path))) throw new MomoError("清單含有不支援的格式。");
        string destination = Convert.ToBoolean(message["shared"],CultureInfo.InvariantCulture) ? momoFolder : null;
        bool preferPhotoshop = (string)message["mode"] == "photoshop";
        var progress = new Progress<MomoBatch.Progress>(row=>ToolProgress("momoProgress",row));
        momoResultFolders = new string[0];
        using (momoCancellation = new CancellationTokenSource())
        {
            try
            {
                var token = momoCancellation.Token;
                var result = await RunSta(()=>MomoBatch.Run(files,destination,preferPhotoshop,token,progress));
                momoResultFolders = result.folders;
                return result;
            }
            finally { momoCancellation = null; }
        }
    }

    private static int ToolInt(Dictionary<string,object> message,string key)
    {
        object value;
        if (!message.TryGetValue(key,out value) || !(value is int))
            throw new MomoError("請輸入有效的正整數。");
        return (int)value;
    }

    private async Task<object> RunSplit(Dictionary<string,object> message)
    {
        if (momoCancellation != null || splitCancellation != null || renaming || converting) throw new MomoError("另一個批次仍在執行。");
        string[] files = MessageFiles(message);
        string mode = (string)message["mode"];
        string format = message.ContainsKey("format") ? message["format"] as string : "png";
        if (format != "png" && format != "jpg") throw new MomoError("請選擇 JPG 或 PNG。");
        int first = ToolInt(message,"first"), second = ToolInt(message,"second");
        string destination = Convert.ToBoolean(message["shared"],CultureInfo.InvariantCulture) ? splitFolder : null;
        var progress = new Progress<ImageSplit.Row>(row=>ToolProgress("splitProgress",row));
        splitResultFolders = new string[0];
        using (splitCancellation = new CancellationTokenSource())
        {
            try
            {
                var token = splitCancellation.Token;
                var result = await Task.Run(()=>ImageSplit.Run(files,destination,mode,first,second,format,token,progress));
                splitResultFolders = result.folders;
                return result;
            }
            finally { splitCancellation = null; }
        }
    }

    private async Task<object> RunRename(Dictionary<string,object> message)
    {
        if (renaming || momoCancellation != null || splitCancellation != null || converting) throw new MomoError("另一個批次仍在執行。");
        if (!Directory.Exists(renameFolder)) throw new MomoError("請先選擇可用的輸出資料夾。");
        var options = new RenameBatch.Options {
            Name = message["name"] as string,
            Digits = Convert.ToInt32(message["digits"],CultureInfo.InvariantCulture),
            Pattern = (string)message["pattern"],
            Format = (string)message["format"],
            Move = Convert.ToBoolean(message["move"],CultureInfo.InvariantCulture)
        };
        if (options.Digits < 1 || options.Digits > 4 || (options.Name ?? "").Length > 120 ||
            !new[] {"number_","number-","name_","name-"}.Contains(options.Pattern) ||
            !new[] {"keep","jpg","png"}.Contains(options.Format)) throw new MomoError("重新命名的設定無效。");
        string[] files = MessageFiles(message);
        var staged = new Dictionary<string,byte[]>(renameStaged,StringComparer.OrdinalIgnoreCase);
        renameStaged.Clear();
        if (options.Move && MessageBox.Show(this,
            "移動模式會在新檔成功輸出後移除原檔。要繼續嗎？",
            "確認移動",MessageBoxButtons.YesNo,MessageBoxIcon.Warning,MessageBoxDefaultButton.Button2) != DialogResult.Yes)
            return new RenameBatch.Result { cancelled = true, moved = new string[0] };
        string folder = renameFolder;
        var progress = new Progress<RenameBatch.Row>(row=>ToolProgress("renameProgress",row));
        renaming = true;
        renameResultFolders = new string[0];
        try
        {
            var result = await Task.Run(()=>RenameBatch.Run(files,folder,options,staged,progress));
            var removedIds = new List<string>();
            foreach (var source in result.moved)
            {
                string id;
                if (toolIds.TryGetValue(source,out id))
                {
                    removedIds.Add(id);
                    toolIds.Remove(source);
                    toolPaths.Remove(id);
                }
            }
            result.moved = removedIds.ToArray();
            if (result.completed > 0) renameResultFolders = new[] {folder};
            return result;
        }
        finally { renaming = false; }
    }

    private void ToolProgress(string type,object value)
    {
        if (!IsDisposed && view.CoreWebView2 != null) Reply(new { @event = type, value });
    }

    private static Task<T> RunSta<T>(Func<T> work)
    {
        var pending = new TaskCompletionSource<T>();
        var thread = new Thread(()=>{
            try { pending.SetResult(work()); } catch (Exception error) { pending.SetException(error); }
        }) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return pending.Task;
    }

    private static string ThumbnailMime(string path)
    {
        switch (Path.GetExtension(path).ToLowerInvariant())
        {
            case ".jpg": case ".jpeg": return "image/jpeg";
            case ".png": return "image/png";
            case ".bmp": return "image/bmp";
            case ".gif": return "image/gif";
            case ".webp": return "image/webp";
            default: return null;
        }
    }

    private Stream OpenToolImage(string id,out string mime)
    {
        string path;
        mime = null;
        if (!toolPaths.TryGetValue(id,out path)) return null;
        try
        {
            mime = ThumbnailMime(path);
            if (mime != null) return new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite | FileShare.Delete);
            if (!HasNativeThumbnail(path)) return null;

            using (var image = Path.GetExtension(path).Equals(".psd",StringComparison.OrdinalIgnoreCase)
                ? PsdComposite.Open(path) : Image.FromFile(path,true))
            {
                MomoBatch.ApplyOrientation(image);
                double ratio = 144.0/Math.Max(image.Width,image.Height);
                using (var thumb = image.GetThumbnailImage(Math.Max(1,(int)(ratio*image.Width)),
                    Math.Max(1,(int)(ratio*image.Height)),null,IntPtr.Zero))
                using (var encoded = new MemoryStream())
                {
                    thumb.Save(encoded,ImageFormat.Png);
                    mime = "image/png";
                    return new MemoryStream(encoded.ToArray(),false);
                }
            }
        }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
        catch (ArgumentException) { return null; }
        catch (MomoError) { return null; }
    }

    private static bool HasNativeThumbnail(string path)
    {
        return new[] {".tif",".tiff",".psd"}.Contains(Path.GetExtension(path),StringComparer.OrdinalIgnoreCase);
    }
}
