using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading;

internal static class ImageSplit
{
    internal const string Extensions = "*.jpg;*.jpeg;*.png;*.bmp;*.gif;*.tif;*.tiff";
    internal const string OutputFolder = "圖片拆分";
    private const int MaxTiles = 4096;

    internal static bool Supports(string path)
    {
        return Extensions.Split(';').Contains("*"+Path.GetExtension(path),StringComparer.OrdinalIgnoreCase);
    }

    internal class Plan
    {
        public int[] x, y;
        public int count { get { return (x.Length-1)*(y.Length-1); } }
    }

    internal static Plan Layout(int width,int height,string mode,int first,int second)
    {
        if (width < 1 || height < 1 || first < 1 || second < 1 ||
            !new[] {"horizontal","vertical","pixels","grid"}.Contains(mode))
            throw new MomoError("請輸入有效的正整數。");
        bool pixels = mode == "pixels";
        int columns = pixels ? (width-1)/first+1 : mode == "vertical" ? 1 : first;
        int rows = pixels ? (height-1)/second+1 : mode == "horizontal" ? 1 : mode == "vertical" ? first : second;
        if (columns > width || rows > height) throw new MomoError("欄數或列數不能超過圖片的像素尺寸。");
        if ((long)columns*rows > MaxTiles) throw new MomoError("每張來源最多可切成 4,096 塊，請減少份數或加大區塊。");
        return new Plan {
            x = Boundaries(width,columns,pixels ? first : 0),
            y = Boundaries(height,rows,pixels ? second : 0)
        };
    }

    private static int[] Boundaries(int length,int count,int step)
    {
        var edges = new int[count+1];
        for (int i=1;i<count;i++) edges[i] = step > 0 ? i*step : (int)((long)i*length/count);
        edges[count] = length;
        return edges;
    }

    private static Image Open(string path)
    {
        if (!Supports(path)) throw new MomoError("這個圖片格式不支援拆分。");
        var image = Image.FromFile(path,true);
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

    internal static object Preview(string path)
    {
        try
        {
            using (var image = Open(path))
            using (var data = new MemoryStream())
            {
                double scale = Math.Min(1,600.0/Math.Max(image.Width,image.Height));
                var area = new Rectangle(0,0,image.Width,image.Height);
                using (var preview = Render(image,area,Math.Max(1,(int)Math.Round(image.Width*scale)),
                    Math.Max(1,(int)Math.Round(image.Height*scale)),InterpolationMode.HighQualityBicubic))
                    preview.Save(data,ImageFormat.Png);
                return new { width = image.Width, height = image.Height,
                    src = "data:image/png;base64,"+Convert.ToBase64String(data.ToArray()) };
            }
        }
        catch (Exception error) { throw new MomoError(Describe(error)); }
    }

    private static Bitmap Render(Image image,Rectangle source,int width,int height,InterpolationMode interpolation)
    {
        var bitmap = new Bitmap(width,height,PixelFormat.Format32bppArgb);
        try
        {
            using (var graphics = Graphics.FromImage(bitmap))
            using (var attrs = new ImageAttributes())
            {
                attrs.SetWrapMode(WrapMode.TileFlipXY);
                graphics.CompositingMode = CompositingMode.SourceCopy;
                graphics.InterpolationMode = interpolation;
                graphics.PixelOffsetMode = PixelOffsetMode.Half;
                graphics.DrawImage(image,new Rectangle(0,0,width,height),source.X,source.Y,
                    source.Width,source.Height,GraphicsUnit.Pixel,attrs);
            }
            return bitmap;
        }
        catch { bitmap.Dispose(); throw; }
    }

    private static string Describe(Exception error)
    {
        if (error is MomoError) return error.Message;
        if (error is UnauthorizedAccessException) return "沒有讀取圖片或寫入輸出資料夾的權限。";
        if (error is FileNotFoundException) return "找不到來源圖片。";
        if (error is IOException) return "無法讀寫圖片，請確認路徑和可用空間。";
        if (error is ArgumentException || error is OutOfMemoryException) return "無法解讀圖片，或圖片尺寸超出可處理範圍。";
        return "圖片拆分失敗，請確認圖片和輸出位置。";
    }

    internal class Row
    {
        public string name, folder, note;
        public int completed, count;
        public bool failed;
    }

    internal class Result
    {
        public int completed, tiles, failed;
        public bool cancelled;
        public string[] folders;
    }

    internal static Result Run(string[] files,string destination,string mode,int first,int second,string format,
        CancellationToken token,IProgress<Row> progress)
    {
        int completed = 0, tiles = 0, failed = 0;
        var folders = new List<string>();
        foreach (string path in files)
        {
            if (token.IsCancellationRequested) break;
            var row = new Row { name = Path.GetFileName(path) };
            try
            {
                using (var image = Open(path))
                {
                    var plan = Layout(image.Width,image.Height,mode,first,second);
                    string parent = destination ?? Path.Combine(Path.GetDirectoryName(path),OutputFolder);
                    row.folder = Save(image,plan,parent,Path.GetFileNameWithoutExtension(path),format,token);
                    row.count = plan.count;
                    tiles += row.count;
                    folders.Add(row.folder);
                    row.note = "已輸出 "+row.count+" 張 "+format.ToUpperInvariant()+"。";
                }
            }
            catch (OperationCanceledException) { break; }
            catch (Exception error) { row.failed = true; failed++; row.note = Describe(error); }
            row.completed = ++completed;
            progress.Report(row);
        }
        return new Result { completed = completed, tiles = tiles, failed = failed,
            cancelled = token.IsCancellationRequested, folders = folders.ToArray() };
    }

    private static string Save(Image image,Plan plan,string parent,string name,string format,CancellationToken token)
    {
        Directory.CreateDirectory(parent);
        string staging = Path.Combine(parent,".camp168-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(staging);
        try
        {
            int number = 0;
            for (int y=1;y<plan.y.Length;y++)
            for (int x=1;x<plan.x.Length;x++)
            {
                token.ThrowIfCancellationRequested();
                var crop = Rectangle.FromLTRB(plan.x[x-1],plan.y[y-1],plan.x[x],plan.y[y]);
                string filename = name+"_"+(++number).ToString("D3",CultureInfo.InvariantCulture)+"."+format;
                using (var tile = Render(image,crop,crop.Width,crop.Height,InterpolationMode.NearestNeighbor))
                {
                    using (var output = new FileStream(Path.Combine(staging,filename),FileMode.CreateNew,FileAccess.Write,FileShare.None))
                    {
                        if (format == "png") tile.Save(output,ImageFormat.Png);
                        else ImageConvert.Encode(tile,format,output);
                    }
                }
            }
            for (int suffix=1;;suffix++)
            {
                token.ThrowIfCancellationRequested();
                string folder = Path.Combine(parent,suffix == 1 ? name : name+" ("+suffix+")");
                try { Directory.Move(staging,folder); return folder; }
                catch (IOException)
                {
                    if (!Directory.Exists(folder) && !File.Exists(folder)) throw;
                }
            }
        }
        finally
        {
            if (Directory.Exists(staging))
            {
                foreach (string file in Directory.EnumerateFiles(staging)) File.Delete(file);
                Directory.Delete(staging);
            }
        }
    }
}
