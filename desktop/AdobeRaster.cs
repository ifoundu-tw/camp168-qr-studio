using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal static class AdobeRaster
{
    internal static string[] ReadIllustrator(string source,string temporary,int edge = 1000)
    {
        if (HasPdfArtwork(source))
        {
            try { return RenderPdf(source,temporary,edge); }
            catch (MomoError) { }
        }
        var js = new JavaScriptSerializer();
        string result = Execute("Illustrator.Application","Illustrator",
            "var source = new File("+js.Serialize(source)+"); var output = "+js.Serialize(temporary.Replace('\\','/'))+
            "; var edge = "+edge.ToString(CultureInfo.InvariantCulture)+";\n"+IllustratorScript);
        if (result.StartsWith("ERROR:",StringComparison.Ordinal))
            throw new MomoError("Illustrator 無法開啟或匯出這個 AI 檔。請檢查檔案、字型及連結素材。");
        return Rendered(temporary);
    }

    internal static byte[] PhotoshopJpeg(string source,string temporary)
    {
        var js = new JavaScriptSerializer();
        string output = Path.Combine(temporary,"photoshop.jpg");
        string result = Execute("Photoshop.Application","Photoshop",
            "var source = new File("+js.Serialize(source)+"); var output = new File("+js.Serialize(output)+");\n"+PhotoshopScript);
        if (result.StartsWith("SIZE:",StringComparison.Ordinal))
            throw new MomoError("Photoshop 最低 JPEG 品質仍未低於 500,000 bytes。");
        if (!File.Exists(output) || result.StartsWith("ERROR:",StringComparison.Ordinal))
            throw new MomoError("Photoshop 無法開啟或轉換這個檔案。");
        return File.ReadAllBytes(output);
    }

    private static string Execute(string progId,string product,string script)
    {
        var type = Type.GetTypeFromProgID(progId);
        if (type == null) throw new MomoError("此檔案需要 "+product+"，目前 Windows 未找到可用的 "+product+"。");
        object app = null;
        try
        {
            app = Activator.CreateInstance(type);
            object result = ((dynamic)app).DoJavaScript(script);
            return Convert.ToString(result,CultureInfo.InvariantCulture) ?? "";
        }
        catch
        {
            throw new MomoError("無法使用 "+product+" 處理此檔。若有對話框，請先處理後重試。");
        }
        finally { if (app != null && Marshal.IsComObject(app)) Marshal.ReleaseComObject(app); }
    }

    private static bool HasPdfArtwork(string path)
    {
        try
        {
            using (var file = new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite))
            {
                var bytes = new byte[(int)Math.Min(file.Length,65536)];
                int length = file.Read(bytes,0,bytes.Length);
                if (length < 5 || Encoding.ASCII.GetString(bytes,0,5) != "%PDF-") return false;
                var preview = Encoding.GetEncoding(28591).GetString(bytes,0,length);
                if (HasPlaceholder(preview)) return false;
                // Illustrator may store its "without PDF content" banner in a small Flate stream.
                bool hasIllustratorPrivateData = preview.IndexOf("/AIPrivateData",StringComparison.Ordinal) >= 0;
                foreach (Match stream in Regex.Matches(preview,@"\bstream(?:\r\n|\r|\n)",RegexOptions.CultureInvariant))
                {
                    int start = stream.Index+stream.Length;
                    if (start+2 >= length || (bytes[start]&15) != 8 ||
                        (bytes[start+1]&32) != 0 || ((bytes[start]<<8)+bytes[start+1])%31 != 0) continue;
                    int end = preview.IndexOf("endstream",start,StringComparison.Ordinal);
                    if (end < 0 || end-start > 16384) continue;
                    try
                    {
                        using (var compressed = new MemoryStream(bytes,start+2,end-start-2))
                        using (var inflate = new DeflateStream(compressed,CompressionMode.Decompress))
                        {
                            byte[] content = new byte[16384];
                            int read = inflate.Read(content,0,content.Length);
                            string decoded = Encoding.GetEncoding(28591).GetString(content,0,read);
                            if (HasPlaceholder(decoded) || (hasIllustratorPrivateData && HasTiledNotice(decoded)))
                                return false;
                        }
                    }
                    catch (InvalidDataException) { }
                }
                return true;
            }
        }
        catch (IOException) { return false; }
    }

    private static bool HasPlaceholder(string text)
    {
        string compact = Regex.Replace(text,"[^a-zA-Z]","").ToLowerInvariant();
        return compact.Contains("savedwithoutpdfcontent") || compact.Contains("to place or open this file in other applications".Replace(" ",""));
    }

    private static bool HasTiledNotice(string content)
    {
        // Illustrator's localized compatibility banner tiles one form at fixed positions.
        return Regex.Matches(content,@"1\s+0\s+0\s+-1\s+(?:171|456)\s+\d+(?:\.\d+)?\s+cm\s+/Perceptual\s+ri\s+0\s+TL/Fm0\s+Do",
                RegexOptions.CultureInvariant).Count >= 4;
    }

    internal static string[] ReadPdf(string source,string temporary)
    {
        return RenderPdf(source,temporary,0);
    }

    private static string[] RenderPdf(string source,string temporary,int edge)
    {
        // A short-lived Windows worker renders PDF-compatible AI artboards via Windows.Data.Pdf.
        string command = "-NoProfile -NonInteractive -EncodedCommand "+
            Convert.ToBase64String(Encoding.Unicode.GetBytes(PdfScript));
        string powershell = Path.Combine(Environment.SystemDirectory,"WindowsPowerShell","v1.0","powershell.exe");
        var info = new ProcessStartInfo(powershell,command) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true
        };
        info.EnvironmentVariables["CAMP168_AI_SOURCE"] = source;
        info.EnvironmentVariables["CAMP168_AI_OUTPUT"] = temporary;
        info.EnvironmentVariables["CAMP168_AI_EDGE"] = edge.ToString(CultureInfo.InvariantCulture);
        using (var worker = Process.Start(info))
        {
            if (worker == null) throw new MomoError("Windows PDF 轉圖未能啟動。");
            worker.BeginErrorReadLine();
            worker.BeginOutputReadLine();
            if (!worker.WaitForExit(180000))
            {
                worker.Kill();
                throw new MomoError("Windows PDF 轉圖逾時。");
            }
            if (worker.ExitCode != 0)
            {
                foreach (string page in Directory.GetFiles(temporary,"page_*.png")) File.Delete(page);
                throw new MomoError("Windows 無法讀取這個 PDF 或 AI 相容圖稿。");
            }
        }
        return Rendered(temporary);
    }

    private static string[] Rendered(string directory)
    {
        var images = Directory.GetFiles(directory,"page_*.png").OrderBy(path=>path,StringComparer.OrdinalIgnoreCase).ToArray();
        if (images.Length == 0) throw new MomoError("AI 檔案沒有可匯出的工作區。");
        return images;
    }

    private const string PdfScript = @"
$ErrorActionPreference='Stop'
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null=[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]
    $null=[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
    $null=[Windows.Storage.StorageFolder, Windows.Storage, ContentType=WindowsRuntime]
    $null=[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $methods=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1}
    $generic=$methods | Where-Object {$_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation' + [char]96 + '1'} | Select-Object -First 1
    $action=$methods | Where-Object {!$_.IsGenericMethod -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'} | Select-Object -First 1
    function Await($operation,[type]$result) {
        if ($result) {
            $task=$generic.MakeGenericMethod($result).Invoke($null,@($operation))
            $task.GetAwaiter().GetResult()
        } else {
            $task=$action.Invoke($null,@($operation))
            $task.GetAwaiter().GetResult()
        }
    }
    $source=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:CAMP168_AI_SOURCE)) ([Windows.Storage.StorageFile])
    $folder=Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($env:CAMP168_AI_OUTPUT)) ([Windows.Storage.StorageFolder])
    $pdf=Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($source)) ([Windows.Data.Pdf.PdfDocument])
    if ($pdf.PageCount -lt 1) { throw 'No pages' }
    for($i=0;$i -lt $pdf.PageCount;$i++){
        $page=$pdf.GetPage([uint32]$i)
        try {
            $name='page_{0:D6}.png' -f ($i+1)
            $file=Await ($folder.CreateFileAsync($name)) ([Windows.Storage.StorageFile])
            $stream=Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])
            try {
                $options=[Windows.Data.Pdf.PdfPageRenderOptions]::new()
                $edge=[uint32]$env:CAMP168_AI_EDGE
                if($edge -gt 0){
                    if($page.Size.Width -ge $page.Size.Height){$options.DestinationWidth=$edge}else{$options.DestinationHeight=$edge}
                } else {
                    $null=[Windows.UI.Colors, Windows.UI, ContentType=WindowsRuntime]
                    $options.BackgroundColor=[Windows.UI.Colors]::Transparent
                }
                Await ($page.RenderToStreamAsync($stream,$options))
            } finally { $stream.Dispose() }
        } finally { $page.Dispose() }
    }
    exit 0
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";

    private const string IllustratorScript = @"
(function () {
  var previous = app.userInteractionLevel, doc = null, opened = false, active = 0, prior = null;
  try {
    if (app.documents.length) prior = app.activeDocument;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    for (var i=0;i<app.documents.length;i++) {
      try { if (app.documents[i].fullName.fsName.toLowerCase() === source.fsName.toLowerCase()) { doc=app.documents[i]; break; } } catch (_) {}
    }
    if (!doc) { doc=app.open(source); opened=true; }
    active=doc.artboards.getActiveArtboardIndex();
    var options=new ExportOptionsPNG24();
    options.antiAliasing=true; options.artBoardClipping=true; options.transparency=true;
    for (var i=0;i<doc.artboards.length;i++) {
      doc.artboards.setActiveArtboardIndex(i);
      var box=doc.artboards[i].artboardRect;
      var side=Math.max(Math.abs(box[2]-box[0]),Math.abs(box[1]-box[3]));
      if (side<=0) throw new Error('Invalid artboard size');
      options.horizontalScale=edge>0?100*edge/side:100; options.verticalScale=options.horizontalScale;
      var number=('000000'+(i+1)).slice(-6);
      doc.exportFile(new File(output+'/page_'+number),ExportType.PNG24,options);
    }
    return 'OK';
  } catch (e) { return 'ERROR:'+String(e); }
  finally {
    try {
      if (doc && opened) doc.close(SaveOptions.DONOTSAVECHANGES);
      else if (doc) doc.artboards.setActiveArtboardIndex(active);
      if (prior) prior.activate();
    } catch (_) {}
    app.userInteractionLevel=previous;
  }
})();";

    private const string PhotoshopScript = @"
(function () {
  var dialogs=app.displayDialogs, units=app.preferences.rulerUnits, background=app.backgroundColor;
  var prior=app.documents.length?app.activeDocument:null, doc=null, alreadyOpen=false;
  try {
    app.displayDialogs=DialogModes.NO;
    app.preferences.rulerUnits=Units.PIXELS;
    var white=new SolidColor(); white.rgb.red=255; white.rgb.green=255; white.rgb.blue=255;
    app.backgroundColor=white;
    for (var i=0;i<app.documents.length;i++) {
      try { if (app.documents[i].fullName.fsName.toLowerCase()===source.fsName.toLowerCase()) { doc=app.documents[i].duplicate(); alreadyOpen=true; break; } } catch (_) {}
    }
    if (!doc) doc=app.open(source);
    var w=doc.width.as('px'), h=doc.height.as('px');
    if (!alreadyOpen && w===1000 && h===1000 && /\.jpe?g$/i.test(source.name) && source.length>0 && source.length<500000) {
      if (source.copy(output.fsName)) return 'OK';
      throw new Error('Cannot copy original');
    }
    if (doc.mode!==DocumentMode.RGB) doc.changeMode(ChangeMode.RGB);
    doc.bitsPerChannel=BitsPerChannelType.EIGHT;
    doc.flatten();
    var method=Math.max(w,h)<1000?ResampleMethod.BICUBICSMOOTHER:ResampleMethod.BICUBICSHARPER;
    if (w>=h) doc.resizeImage(UnitValue(1000,'px'),null,null,method);
    else doc.resizeImage(null,UnitValue(1000,'px'),null,method);
    doc.resizeCanvas(UnitValue(1000,'px'),UnitValue(1000,'px'),AnchorPosition.MIDDLECENTER);
    for (var q=12;q>=0;q--) {
      var options=new JPEGSaveOptions(); options.quality=q; options.embedColorProfile=false;
      options.formatOptions=FormatOptions.OPTIMIZEDBASELINE;
      if (output.exists) output.remove();
      doc.saveAs(output,options,true,Extension.LOWERCASE);
      var check=new File(output.fsName);
      if (check.exists && check.length>0 && check.length<500000) return 'OK';
    }
    return 'SIZE:';
  } catch (e) { return 'ERROR:'+String(e); }
  finally {
    try { if (doc) doc.close(SaveOptions.DONOTSAVECHANGES); if (prior) app.activeDocument=prior; } catch (_) {}
    app.preferences.rulerUnits=units; app.backgroundColor=background; app.displayDialogs=dialogs;
  }
})();";
}
