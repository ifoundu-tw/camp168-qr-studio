using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

internal static class RenameBatch
{
    internal sealed class Options
    {
        internal string Name;
        internal int Digits;
        internal string Pattern;
        internal string Format;
        internal bool Move;
    }

    internal sealed class Row
    {
        public int index { get; set; }
        public string name { get; set; }
        public string message { get; set; }
        public bool failed { get; set; }
        public bool moved { get; set; }
    }

    internal sealed class Result
    {
        public int completed { get; set; }
        public int failed { get; set; }
        public bool cancelled { get; set; }
        public string[] moved { get; set; }
    }

    private static string OutputName(string source,int index,Options options)
    {
        string name = Regex.Replace((options.Name ?? "").Trim(),"[<>:\"/\\\\|?*\\x00-\\x1f]","_").TrimEnd(' ','.');
        if (name.Length == 0) name = "未命名";
        string number = (index+1).ToString("D"+options.Digits,CultureInfo.InvariantCulture);
        string separator = options.Pattern.EndsWith("-") ? "-" : "_";
        string stem = options.Pattern.StartsWith("name",StringComparison.Ordinal) ? name+separator+number : number+separator+name;
        string extension = options.Format == "keep" ? Path.GetExtension(source) : "."+options.Format;
        return stem+extension;
    }

    internal static Result Run(string[] files,string folder,Options options,IDictionary<string,byte[]> staged,IProgress<Row> progress)
    {
        var result = new Result { moved = new string[0] };
        var removed = new List<string>();
        var targets = files.Select((source,index)=>Path.Combine(folder,OutputName(source,index,options))).ToArray();
        var collisions = targets.Where(path=>File.Exists(path)||Directory.Exists(path)).Select(Path.GetFileName).ToArray();
        if (collisions.Length > 0) throw new MomoError("輸出資料夾已有同名檔案，例如 "+collisions[0]+"。請更換資料夾或檔名。");
        if (targets.Distinct(StringComparer.OrdinalIgnoreCase).Count() != targets.Length)
            throw new MomoError("不同來源產生同名檔案，請檢查命名設定。");
        if (options.Format != "keep")
        {
            var invalid = files.Where(path=>!CanConvert(path,staged)).Select(Path.GetFileName).ToArray();
            if (invalid.Length > 0)
                throw new MomoError("有 "+invalid.Length+" 個檔案無法轉圖，例如 "+invalid[0]+"。請移除該檔或選擇保留原始格式。");
        }

        for (int i=0;i<files.Length;i++)
        {
            string source = files[i], destination = targets[i];
            string outputName = Path.GetFileName(destination);
            progress.Report(new Row { index = i, name = outputName, message = "處理中…" });
            bool committed = false;
            try
            {
                if (String.Equals(source,destination,StringComparison.OrdinalIgnoreCase))
                    throw new MomoError("來源和輸出位置相同。");
                if (options.Format == "keep" && options.Move)
                {
                    File.Move(source,destination);
                    removed.Add(source);
                    committed = true;
                }
                else if (options.Format == "keep")
                {
                    File.Copy(source,destination,false);
                    committed = true;
                }
                else
                {
                    byte[] replacement;
                    if (staged.TryGetValue(source,out replacement))
                    {
                        using (var buffer = new MemoryStream(replacement,false))
                        using (var image = Image.FromStream(buffer,false,true))
                        {
                            Guid expected = options.Format == "jpg" ? ImageFormat.Jpeg.Guid : ImageFormat.Png.Guid;
                            if (image.RawFormat.Guid != expected) throw new MomoError("轉換後的圖片格式檢查失敗。");
                        }
                    }
                    else replacement = ConvertImage(source,options.Format);
                    WriteConverted(destination,replacement);
                    committed = true;
                    if (options.Move)
                    {
                        File.Delete(source);
                        removed.Add(source);
                    }
                }
                result.completed++;
                progress.Report(new Row { index = i, name = outputName, moved = options.Move, message = "完成" });
            }
            catch (Exception error)
            {
                result.failed++;
                string message = committed ? "新檔已輸出，但原檔無法移除。" : error is MomoError ? error.Message :
                    error is UnauthorizedAccessException ? "無法存取檔案，請檢查權限。" :
                    error is IOException ? "無法寫入檔案。請檢查來源、同名檔案及輸出資料夾。" :
                    "無法讀取此圖片。可選擇「保留原始格式」來重新命名。";
                progress.Report(new Row { index = i, name = outputName, message = message, failed = true });
                break;
            }
        }
        result.moved = removed.ToArray();
        return result;
    }

    private static void WriteConverted(string destination,byte[] bytes)
    {
        var stream = new FileStream(destination,FileMode.CreateNew,FileAccess.Write,FileShare.None);
        try
        {
            using (stream) stream.Write(bytes,0,bytes.Length);
            if (new FileInfo(destination).Length != bytes.Length) throw new IOException();
        }
        catch
        {
            try { File.Delete(destination); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            throw;
        }
    }

    private static byte[] ConvertImage(string source,string format)
    {
        using (var image = OpenImage(source))
        {
            MomoBatch.ApplyOrientation(image);
            bool jpeg = format == "jpg";
            using (var frame = new Bitmap(image.Width,image.Height,jpeg ? PixelFormat.Format24bppRgb : PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(frame))
                {
                    g.CompositingMode = jpeg ? CompositingMode.SourceOver : CompositingMode.SourceCopy;
                    g.Clear(jpeg ? Color.White : Color.Transparent);
                    g.DrawImageUnscaled(image,0,0);
                }
                using (var output = new MemoryStream())
                {
                    if (jpeg)
                    {
                        using (var pars = new EncoderParameters(1))
                        {
                            pars.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,94L);
                            frame.Save(output,ImageCodecInfo.GetImageEncoders().First(codec=>codec.FormatID == ImageFormat.Jpeg.Guid),pars);
                        }
                    }
                    else frame.Save(output,ImageFormat.Png);
                    return output.ToArray();
                }
            }
        }
    }

    private static Image OpenImage(string source)
    {
        return Path.GetExtension(source).Equals(".psd",StringComparison.OrdinalIgnoreCase)
            ? PsdComposite.Open(source) : Image.FromFile(source,true);
    }

    private static bool CanConvert(string path,IDictionary<string,byte[]> staged)
    {
        try
        {
            byte[] bytes;
            if (staged.TryGetValue(path,out bytes))
            {
                using (var data = new MemoryStream(bytes,false))
                using (var image = Image.FromStream(data,false,true)) return image.Width > 0 && image.Height > 0;
            }
            using (var image = OpenImage(path)) return image.Width > 0 && image.Height > 0;
        }
        catch (Exception error)
        {
            if (error is IOException || error is ArgumentException || error is OutOfMemoryException ||
                error is UnauthorizedAccessException || error is MomoError) return false;
            throw;
        }
    }
}
