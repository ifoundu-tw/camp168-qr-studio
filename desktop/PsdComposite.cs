using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Compression;
using System.Runtime.InteropServices;

internal static class PsdComposite
{
    internal static Bitmap Open(string path)
    {
        try { return Read(path); }
        catch (Exception error)
        {
            if (error is UnauthorizedAccessException || error is OutOfMemoryException) throw;
            throw new MomoError("無法讀取 PSD 合成影像。需要 Photoshop 開啟並重新算圖。");
        }
    }

    private static Bitmap Read(string path)
    {
        using (var reader = new BinaryReader(File.OpenRead(path)))
        {
            if (new string(reader.ReadChars(4)) != "8BPS" || UInt16(reader) != 1) throw new InvalidDataException();
            reader.ReadBytes(6);
            int channels = UInt16(reader);
            int height = Integer(reader), width = Integer(reader);
            int depth = UInt16(reader), mode = UInt16(reader);
            int colorChannels = mode == 3 ? 3 : 1;
            if (width < 1 || height < 1 || (long)width*height > 60000000 || channels < colorChannels ||
                channels > 56 || depth != 8 || (mode != 1 && mode != 3)) throw new InvalidDataException();
            SkipSection(reader);
            SkipSection(reader);
            int layerLength = Integer(reader);
            long layerEnd = reader.BaseStream.Position + layerLength;
            if (layerEnd > reader.BaseStream.Length) throw new EndOfStreamException();
            bool alpha = false;
            if (layerLength >= 6)
            {
                int layerInfo = Integer(reader);
                if (layerInfo >= 2 && layerInfo <= layerLength-4)
                    alpha = unchecked((short)UInt16(reader)) < 0;
            }
            reader.BaseStream.Position = layerEnd;
            int compression = UInt16(reader);
            int wanted = colorChannels + (alpha && channels > colorChannels ? 1 : 0);
            var planes = ReadPlanes(reader,width,height,wanted,channels,compression);
            return ToBitmap(planes,width,height,colorChannels);
        }
    }

    private static byte[][] ReadPlanes(BinaryReader reader,int width,int height,int wanted,int channels,int compression)
    {
        int pixels = checked(width*height);
        var planes = new byte[wanted][];
        if (compression == 0)
        {
            for (int c=0;c<wanted;c++) planes[c] = ReadExact(reader,pixels);
        }
        else if (compression == 1)
        {
            var rowLengths = new int[checked(channels*height)];
            for (int row=0;row<rowLengths.Length;row++) rowLengths[row] = UInt16(reader);
            for (int c=0;c<wanted;c++)
            {
                planes[c] = new byte[pixels];
                for (int row=0;row<height;row++)
                    Unpack(ReadExact(reader,rowLengths[c*height+row]),planes[c],row*width,width);
            }
        }
        else if (compression == 2 || compression == 3)
        {
            // PSD ZIP uses a zlib stream; DeflateStream reads its DEFLATE payload.
            int header = reader.ReadByte(), flags = reader.ReadByte();
            if ((header&15) != 8 || (flags&32) != 0 || ((header<<8)+flags)%31 != 0)
                throw new InvalidDataException();
            using (var deflate = new DeflateStream(reader.BaseStream,CompressionMode.Decompress,true))
            using (var unpacked = new BinaryReader(deflate))
            {
                for (int c=0;c<wanted;c++)
                {
                    var plane = ReadExact(unpacked,pixels);
                    if (compression == 3)
                        for (int row=0;row<height;row++)
                        {
                            int end = row*width+width;
                            for (int x=row*width+1;x<end;x++) plane[x] = unchecked((byte)(plane[x]+plane[x-1]));
                        }
                    planes[c] = plane;
                }
            }
        }
        else throw new InvalidDataException();
        return planes;
    }

    private static void Unpack(byte[] input,byte[] output,int offset,int count)
    {
        int end = offset+count;
        for (int i=0;i<input.Length && offset<end;)
        {
            int run = unchecked((sbyte)input[i++]);
            if (run >= 0)
            {
                int n = run+1;
                if (i+n > input.Length || offset+n > end) throw new InvalidDataException();
                Buffer.BlockCopy(input,i,output,offset,n);
                i += n;
                offset += n;
            }
            else if (run > -128)
            {
                int n = 1-run;
                if (i >= input.Length || offset+n > end) throw new InvalidDataException();
                byte value = input[i++];
                for (int j=0;j<n;j++) output[offset++] = value;
            }
        }
        if (offset != end) throw new InvalidDataException();
    }

    private static Bitmap ToBitmap(byte[][] planes,int width,int height,int colorChannels)
    {
        var image = new Bitmap(width,height,PixelFormat.Format32bppArgb);
        try
        {
            var data = image.LockBits(new Rectangle(0,0,width,height),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb);
            try
            {
                var row = new byte[checked(width*4)];
                for (int y=0;y<height;y++)
                {
                    for (int x=0;x<width;x++)
                    {
                        int i = y*width+x, pixel = x*4;
                        row[pixel] = planes[colorChannels == 3 ? 2 : 0][i];
                        row[pixel+1] = planes[colorChannels == 3 ? 1 : 0][i];
                        row[pixel+2] = planes[0][i];
                        row[pixel+3] = planes.Length > colorChannels ? planes[colorChannels][i] : (byte)255;
                    }
                    Marshal.Copy(row,0,IntPtr.Add(data.Scan0,y*data.Stride),row.Length);
                }
            }
            finally { image.UnlockBits(data); }
            return image;
        }
        catch { image.Dispose(); throw; }
    }

    private static int UInt16(BinaryReader r) { return (r.ReadByte()<<8)|r.ReadByte(); }
    private static int Integer(BinaryReader r)
    {
        int high = UInt16(r), low = UInt16(r);
        return checked(high*65536+low);
    }
    private static void SkipSection(BinaryReader r)
    {
        int length = Integer(r);
        long end = r.BaseStream.Position + length;
        if (end > r.BaseStream.Length) throw new EndOfStreamException();
        r.BaseStream.Position = end;
    }
    private static byte[] ReadExact(BinaryReader r,int length)
    {
        var result = r.ReadBytes(length);
        if (result.Length != length) throw new EndOfStreamException();
        return result;
    }
}
