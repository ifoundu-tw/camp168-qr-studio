using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal sealed class MomoError : Exception
{
    internal MomoError(string message) : base(message) { }
}

internal static class MomoBatch
{
    private const int Edge = 1000;
    private const int Maximum = 500000;
    private const string Header = "來源\t頁面\t輸出\t狀態\t位元組\t說明";
    private static readonly ImageCodecInfo Jpeg = ImageCodecInfo.GetImageEncoders().First(codec => codec.FormatID == ImageFormat.Jpeg.Guid);

    internal static bool Supports(string path)
    {
        return new[] {".jpg",".jpeg",".png",".bmp",".tif",".tiff",".psd",".ai"}
            .Contains(Path.GetExtension(path),StringComparer.OrdinalIgnoreCase);
    }

    internal sealed class Progress
    {
        public string name { get; set; }
        public string output { get; set; }
        public long bytes { get; set; }
        public string note { get; set; }
        public bool failed { get; set; }
        public int completed { get; set; }
        public int total { get; set; }
    }

    internal sealed class Summary
    {
        public int completed { get; set; }
        public int images { get; set; }
        public int failed { get; set; }
        public bool cancelled { get; set; }
        public string[] folders { get; set; }
        public string[] logErrors { get; set; }
    }

    internal static Summary Run(string[] files,string output,bool preferPhotoshop,CancellationToken cancel,IProgress<Progress> progress)
    {
        var result = new Summary();
        var logs = new Dictionary<string,List<string>>(StringComparer.OrdinalIgnoreCase);
        var folders = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var logErrors = new List<string>();
        string logName = "batch_log_" + DateTime.Now.ToString("yyyyMMdd_HHmmss",CultureInfo.InvariantCulture);
        foreach (string file in files)
        {
            if (cancel.IsCancellationRequested) break;
            string name = Path.GetFileName(file);
            string folder = String.IsNullOrEmpty(output) ? Path.Combine(Path.GetDirectoryName(file),"MOMO") : output;
            List<string> lines;
            if (!logs.TryGetValue(folder,out lines)) logs.Add(folder,lines = new List<string> {Header});
            int beforeFailures = result.failed;
            progress.Report(new Progress { name = name, completed = result.completed, total = files.Length, note = "處理中…" });
            string temporary = null;
            try
            {
                Directory.CreateDirectory(folder);
                if (!File.Exists(file)) throw new MomoError("找不到來源檔案。");
                if (!Supports(file)) throw new MomoError("不支援此圖片格式。");
                string extension = Path.GetExtension(file).ToLowerInvariant();
                string stem = Path.GetFileNameWithoutExtension(file);
                if (!preferPhotoshop && (extension == ".jpg" || extension == ".jpeg"))
                {
                    byte[] original = ReadReadyJpeg(file);
                    if (original != null)
                    {
                        Save(original,folder,stem,name,1,"符合規格，直接複製",lines,folders,result,progress,files.Length);
                        result.completed++;
                        continue;
                    }
                }

                if (extension == ".ai" || extension == ".psd" || preferPhotoshop)
                {
                    temporary = Path.Combine(Path.GetTempPath(),"Camp168Momo-"+Guid.NewGuid().ToString("N"));
                    Directory.CreateDirectory(temporary);
                }

                if (extension == ".ai")
                {
                    var rendered = AdobeRaster.ReadIllustrator(file,temporary);
                    for (int i=0;i<rendered.Length;i++)
                    {
                        if (cancel.IsCancellationRequested) break;
                        string pageStem = rendered.Length > 1 ? stem+"_"+(i+1).ToString("00",CultureInfo.InvariantCulture) : stem;
                        try
                        {
                            byte[] bytes;
                            using (var page = Image.FromFile(rendered[i],true)) bytes = Encode(page);
                            Save(bytes,folder,pageStem,name,i+1,"工作區 "+(i+1),lines,folders,result,progress,files.Length);
                        }
                        catch (Exception error)
                        {
                            Failure(name,i+1,error,lines,result,progress,files.Length);
                        }
                    }
                }
                else if (preferPhotoshop)
                {
                    byte[] bytes = AdobeRaster.PhotoshopJpeg(file,temporary);
                    Save(bytes,folder,stem,name,1,"Photoshop",lines,folders,result,progress,files.Length);
                }
                else
                {
                    byte[] bytes;
                    string source = "Windows 本機";
                    if (extension == ".psd")
                    {
                        try
                        {
                            using (var composite = PsdComposite.Open(file)) bytes = Encode(composite);
                            source = "PSD 合成影像";
                        }
                        catch (MomoError)
                        {
                            bytes = AdobeRaster.PhotoshopJpeg(file,temporary);
                            source = "Photoshop";
                        }
                    }
                    else using (var image = Image.FromFile(file,true))
                    {
                        ApplyOrientation(image);
                        bytes = Encode(image);
                    }
                    Save(bytes,folder,stem,name,1,source,lines,folders,result,progress,files.Length);
                }
            }
            catch (Exception error) { Failure(name,1,error,lines,result,progress,files.Length); }
            finally
            {
                if (temporary != null)
                {
                    try
                    {
                        foreach (var tempFile in Directory.GetFiles(temporary)) File.Delete(tempFile);
                        Directory.Delete(temporary);
                    }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
            }
            result.completed++;
            if (result.failed > beforeFailures && Directory.Exists(folder)) folders.Add(folder);
        }
        foreach (var log in logs)
        {
            if (!Directory.Exists(log.Key)) continue;
            try
            {
                byte[] text = new UTF8Encoding(true).GetPreamble()
                    .Concat(Encoding.UTF8.GetBytes(String.Join("\r\n",log.Value)+"\r\n")).ToArray();
                WriteUnique(log.Key,logName,".tsv",text);
            }
            catch { logErrors.Add(log.Key); }
        }
        result.cancelled = cancel.IsCancellationRequested;
        result.folders = folders.ToArray();
        result.logErrors = logErrors.ToArray();
        return result;
    }

    private static string Tsv(string value)
    {
        return (value ?? "").Replace('\t',' ').Replace('\r',' ').Replace('\n',' ');
    }

    private static void Failure(string name,int page,Exception error,List<string> lines,Summary summary,
        IProgress<Progress> progress,int total)
    {
        string message = error is MomoError ? error.Message : error is UnauthorizedAccessException
            ? "無法讀取或寫入檔案，請確認資料夾權限。"
            : "無法讀取或轉換這張圖片，請確認來源檔可開啟及磁碟有足夠空間。";
        summary.failed++;
        lines.Add(Tsv(name)+"\t"+page+"\t\t失敗\t\t"+Tsv(message));
        progress.Report(new Progress { name = name, failed = true, note = message,
            completed = summary.completed+1, total = total });
    }

    private static void Save(byte[] bytes,string folder,string stem,string name,int page,string note,List<string> lines,
        HashSet<string> folders,Summary summary,IProgress<Progress> progress,int total)
    {
        if (bytes.Length == 0 || bytes.Length >= Maximum) throw new MomoError("JPEG 大小驗證未通過，未輸出。");
        using (var data = new MemoryStream(bytes,false))
        using (var check = Image.FromStream(data,false,true))
        {
            if (check.Width != Edge || check.Height != Edge || check.RawFormat.Guid != ImageFormat.Jpeg.Guid)
                throw new MomoError("JPEG 尺寸或格式驗證未通過，未輸出。");
        }
        string written = WriteUnique(folder,stem,".jpg",bytes);
        folders.Add(folder);
        summary.images++;
        string output = Path.GetFileName(written);
        lines.Add(Tsv(name)+"\t"+page+"\t"+Tsv(output)+"\t完成\t"+bytes.Length+"\t"+note);
        progress.Report(new Progress { name = name, output = output, bytes = bytes.Length,
            note = note, completed = summary.completed+1, total = total });
    }

    private static string WriteUnique(string directory,string stem,string extension,byte[] bytes)
    {
        for (int suffix=1; suffix<=10000; suffix++)
        {
            string path = Path.Combine(directory,stem+(suffix > 1 ? "_"+suffix : "")+extension);
            FileStream stream;
            try { stream = new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None); }
            catch (IOException) { if (File.Exists(path) || Directory.Exists(path)) continue; throw; }
            catch (UnauthorizedAccessException) { if (Directory.Exists(path)) continue; throw; }
            try
            {
                using (stream) stream.Write(bytes,0,bytes.Length);
                if (new FileInfo(path).Length != bytes.Length) throw new IOException("輸出檔案大小不相符。");
            }
            catch
            {
                try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
                throw;
            }
            return path;
        }
        throw new MomoError("輸出資料夾內有太多同名檔案。");
    }

    private static byte[] ReadReadyJpeg(string file)
    {
        using (var stream = new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read))
        {
            if (stream.Length == 0 || stream.Length >= Maximum) return null;
            using (var image = Image.FromStream(stream,true,true))
            {
                if (image.Width != Edge || image.Height != Edge || image.RawFormat.Guid != ImageFormat.Jpeg.Guid)
                    return null;
                stream.Position = 0;
                using (var output = new MemoryStream()) { stream.CopyTo(output); return output.ToArray(); }
            }
        }
    }

    internal static void ApplyOrientation(Image image)
    {
        const int Orientation = 0x112;
        if (!image.PropertyIdList.Contains(Orientation)) return;
        var value = image.GetPropertyItem(Orientation).Value;
        if (value == null || value.Length < 2) return;
        ApplyOrientation(image,BitConverter.ToUInt16(value,0));
    }

    internal static void ApplyOrientation(Image image,int index)
    {
        var rotation = new[] { RotateFlipType.RotateNoneFlipNone,RotateFlipType.RotateNoneFlipNone,
            RotateFlipType.RotateNoneFlipX,RotateFlipType.Rotate180FlipNone,RotateFlipType.Rotate180FlipX,
            RotateFlipType.Rotate90FlipX,RotateFlipType.Rotate90FlipNone,RotateFlipType.Rotate270FlipX,RotateFlipType.Rotate270FlipNone };
        if (index > 1 && index < rotation.Length) image.RotateFlip(rotation[index]);
    }

    private static byte[] Encode(Image image)
    {
        if (image.Width < 1 || image.Height < 1) throw new MomoError("圖片尺寸無效。");
        double ratio = (double)Edge/Math.Max(image.Width,image.Height);
        int width = Math.Max(1,(int)Math.Round(image.Width*ratio));
        int height = Math.Max(1,(int)Math.Round(image.Height*ratio));
        using (var square = new Bitmap(Edge,Edge,PixelFormat.Format24bppRgb))
        {
            using (var g = Graphics.FromImage(square))
            using (var attributes = new ImageAttributes())
            {
                g.Clear(Color.White);
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                attributes.SetWrapMode(WrapMode.TileFlipXY);
                g.DrawImage(image,new Rectangle((Edge-width)/2,(Edge-height)/2,width,height),
                    0,0,image.Width,image.Height,GraphicsUnit.Pixel,attributes);
            }
            using (var output = new MemoryStream())
            {
                for (int quality=100;quality>=0;quality-=5)
                {
                    var trial = SaveQuality(square,output,quality);
                    if (trial == null) continue;
                    for (int refine=Math.Min(100,quality+4);refine>quality;refine--)
                    {
                        var better = SaveQuality(square,output,refine);
                        if (better != null) return better;
                    }
                    return trial;
                }
            }
        }
        throw new MomoError("最低 JPEG 品質仍無法低於 500,000 bytes，未輸出。");
    }

    private static byte[] SaveQuality(Bitmap image,MemoryStream output,int quality)
    {
        output.SetLength(0);
        using (var parameters = new EncoderParameters(1))
        {
            parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,(long)quality);
            image.Save(output,Jpeg,parameters);
        }
        return output.Length > 0 && output.Length < Maximum ? output.ToArray() : null;
    }
}
