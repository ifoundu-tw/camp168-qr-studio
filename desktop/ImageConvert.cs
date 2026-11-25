using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Media.Imaging;

internal static class ImageConvert
{
    internal const string OutputFolder = "轉檔輸出";

    internal static string[] Run(string source,string folder,string format,bool preferBrowser)
    {
        string extension = Path.GetExtension(source).ToLowerInvariant();
        if (preferBrowser && new[] {".heic",".heif",".heics",".heifs",".hif",".webp",".avif",".svg"}.Contains(extension))
            return null;

        if (extension == ".ai" || extension == ".pdf")
        {
            string temp = Path.Combine(Path.GetTempPath(),"Camp168Convert-"+Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temp);
            try
            {
                var pages = extension == ".pdf" ? AdobeRaster.ReadPdf(source,temp) : AdobeRaster.ReadIllustrator(source,temp,0);
                return pages.Select((page,index)=>{
                    string stem = Path.GetFileNameWithoutExtension(source);
                    if (pages.Length > 1) stem += "_"+(index+1).ToString("D3",CultureInfo.InvariantCulture);
                    using (var image = Image.FromFile(page,true)) return Save(image,folder,stem,format);
                }).ToArray();
            }
            finally
            {
                foreach (string path in Directory.EnumerateFiles(temp)) File.Delete(path);
                Directory.Delete(temp);
            }
        }

        using (var image = Open(source))
        {
            if (image == null) return null;
            return new[] { Save(image,folder,Path.GetFileNameWithoutExtension(source),format) };
        }
    }

    private static Image Open(string path)
    {
        if (Path.GetExtension(path).Equals(".psd",StringComparison.OrdinalIgnoreCase)) return PsdComposite.Open(path);
        Image image;
        try { image = Image.FromFile(path,true); }
        catch (ArgumentException) { return OpenWindowsImage(path); }
        catch (OutOfMemoryException) { return OpenWindowsImage(path); } // GDI+ also uses this for unknown formats.
        try
        {
            Guid[] frames = image.FrameDimensionsList;
            if (frames.Contains(FrameDimension.Time.Guid)) image.SelectActiveFrame(FrameDimension.Time,0);
            if (frames.Contains(FrameDimension.Page.Guid)) image.SelectActiveFrame(FrameDimension.Page,0);
            MomoBatch.ApplyOrientation(image);
            return image;
        }
        catch { image.Dispose(); throw; }
    }

    private static Bitmap OpenWindowsImage(string path)
    {
        using (var stream = File.OpenRead(path))
        {
            BitmapFrame frame;
            try { frame = BitmapDecoder.Create(stream,BitmapCreateOptions.PreservePixelFormat,BitmapCacheOption.OnDemand).Frames[0]; }
            catch (Exception error)
            {
                if (error is NotSupportedException || error is FileFormatException ||
                    error is ArgumentException || error is COMException) return null;
                throw;
            }
            var pixels = new FormatConvertedBitmap(frame,System.Windows.Media.PixelFormats.Bgra32,null,0);
            int width = pixels.PixelWidth, height = pixels.PixelHeight;
            var bitmap = new Bitmap(width,height,PixelFormat.Format32bppArgb);
            try
            {
                var result = bitmap.LockBits(new Rectangle(0,0,width,height),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb);
                try { pixels.CopyPixels(Int32Rect.Empty,result.Scan0,checked(result.Stride*height),result.Stride); }
                finally { bitmap.UnlockBits(result); }
                MomoBatch.ApplyOrientation(bitmap,WindowsOrientation(frame));
                return bitmap;
            }
            catch { bitmap.Dispose(); throw; }
        }
    }

    private static int WindowsOrientation(BitmapFrame frame)
    {
        try
        {
            var metadata = frame.Metadata as BitmapMetadata;
            if (metadata == null) return 1;
            foreach (string query in new[] {"/app1/ifd/{ushort=274}","/ifd/{ushort=274}"})
            {
                if (metadata.ContainsQuery(query))
                    return Convert.ToInt32(metadata.GetQuery(query),CultureInfo.InvariantCulture);
            }
        }
        catch (NotSupportedException) { }
        catch (COMException) { }
        return 1;
    }

    private static string Save(Image image,string folder,string stem,string format)
    {
        string staged = Temporary(folder);
        try
        {
            using (var stream = new FileStream(staged,FileMode.CreateNew,FileAccess.Write,FileShare.None))
                Encode(image,format,stream);
            return Finish(staged,folder,stem,format);
        }
        finally { DeleteTemporary(staged); }
    }

    internal static void Encode(Image image,string format,Stream output)
    {
        bool jpeg = format == "jpg";
        using (var frame = new Bitmap(image.Width,image.Height,jpeg ? PixelFormat.Format24bppRgb : PixelFormat.Format32bppArgb))
        {
            using (var graphics = Graphics.FromImage(frame))
            {
                graphics.CompositingMode = jpeg ? CompositingMode.SourceOver : CompositingMode.SourceCopy;
                graphics.Clear(jpeg ? Color.White : Color.Transparent);
                graphics.DrawImageUnscaled(image,0,0);
            }
            if (!jpeg) { frame.Save(output,ImageFormat.Png); return; }
            using (var parameters = new EncoderParameters(1))
            {
                parameters.Param[0] = new EncoderParameter(Encoder.Quality,94L);
                frame.Save(output,ImageCodecInfo.GetImageEncoders().First(codec=>codec.FormatID == ImageFormat.Jpeg.Guid),parameters);
            }
        }
    }

    internal static string Temporary(string folder)
    {
        Directory.CreateDirectory(folder);
        return Path.Combine(folder,".camp168-convert-"+Guid.NewGuid().ToString("N")+".part");
    }

    internal static void DeleteTemporary(string path)
    {
        try { if (path != null) File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    internal static string Finish(string staged,string folder,string stem,string format)
    {
        for (int n=1;;n++)
        {
            string name = stem+(n == 1 ? "" : " ("+n+")")+"."+format;
            string destination = Path.Combine(folder,name);
            try { File.Move(staged,destination); return name; }
            catch (IOException)
            {
                if (!File.Exists(destination) && !Directory.Exists(destination)) throw;
            }
        }
    }
}
