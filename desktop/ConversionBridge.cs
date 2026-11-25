using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;

internal sealed partial class StudioForm
{
    private readonly HashSet<string> converterIds = new HashSet<string>(StringComparer.Ordinal);
    private string convertFolder, conversionUpload, conversionDestination, conversionStem, conversionFormat;
    private string[] convertResultFolders = new string[0];
    private bool converting;

    private async Task<object> HandleConversion(string action,Dictionary<string,object> message)
    {
        if (action == "convertAbort")
        {
            ClearConversionUpload();
            return true;
        }
        if (action == "convertChunk")
        {
            string data = message["data"] as string;
            if (conversionUpload == null || String.IsNullOrEmpty(data) || data.Length > 512000)
                throw new MomoError("無法接收轉檔資料。");
            byte[] bytes = Convert.FromBase64String(data);
            using (var stream = new FileStream(conversionUpload,FileMode.Append,FileAccess.Write,FileShare.None))
                stream.Write(bytes,0,bytes.Length);
            return true;
        }
        if (action == "convertFinish")
        {
            if (conversionUpload == null) throw new MomoError("找不到轉檔資料。");
            try
            {
                using (var stream = File.OpenRead(conversionUpload))
                {
                    int first = stream.ReadByte(), second = stream.ReadByte();
                    if (conversionFormat == "jpg" ? first != 255 || second != 216 : first != 137 || second != 80)
                        throw new MomoError("無法驗證轉檔結果。");
                }
                string name = ImageConvert.Finish(conversionUpload,conversionDestination,conversionStem,conversionFormat);
                return ConversionResult(conversionDestination,new[] {name});
            }
            finally { ClearConversionUpload(); }
        }

        string id = message["file"] as string, source;
        if (id == null || !converterIds.Contains(id) || !toolPaths.TryGetValue(id,out source))
            throw new MomoError("找不到這張來源圖片。");
        string format = message["format"] as string;
        if (format != "jpg" && format != "png") throw new MomoError("請選擇 JPG 或 PNG。");
        bool shared = (bool)message["shared"];
        if (shared && String.IsNullOrEmpty(convertFolder)) throw new MomoError("請選擇輸出資料夾。");
        string folder = shared ? convertFolder : Path.Combine(Path.GetDirectoryName(source),ImageConvert.OutputFolder);
        if (action == "convertBegin")
        {
            ClearConversionUpload();
            string stage = ImageConvert.Temporary(folder);
            using (File.Open(stage,FileMode.CreateNew,FileAccess.Write,FileShare.None)) { }
            conversionUpload = stage;
            conversionDestination = folder;
            conversionStem = Path.GetFileNameWithoutExtension(source);
            conversionFormat = format;
            return true;
        }

        if (renaming || momoCancellation != null || splitCancellation != null || converting)
            throw new MomoError("另一個批次仍在執行。");
        converting = true;
        try
        {
            bool preferBrowser = !(bool)message["nativeOnly"];
            var names = await RunSta(()=>ImageConvert.Run(source,folder,format,preferBrowser));
            return names == null ? (object)new { browser = true } : ConversionResult(folder,names);
        }
        finally { converting = false; }
    }

    private object ConversionResult(string folder,string[] names)
    {
        int index = Array.FindIndex(convertResultFolders,value=>String.Equals(value,folder,StringComparison.OrdinalIgnoreCase));
        if (index < 0)
        {
            index = convertResultFolders.Length;
            Array.Resize(ref convertResultFolders,index+1);
            convertResultFolders[index] = folder;
        }
        return new { folder, index, names };
    }

    private void ClearConversionUpload()
    {
        ImageConvert.DeleteTemporary(conversionUpload);
        conversionUpload = null;
    }

    private Stream OpenConversionImage(string id)
    {
        string path;
        if (!converterIds.Contains(id) || !toolPaths.TryGetValue(id,out path)) return null;
        try { return new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite | FileShare.Delete); }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
    }
}
