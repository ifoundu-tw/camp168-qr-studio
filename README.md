# 美工必備小工具 by yue

由 yue 製作的 Windows 單檔工具，包含條碼生成、MOMO 圖片轉檔與批次重新命名。

## 使用方式

1. 從 [GitHub Releases](https://github.com/ifoundu-tw/camp168-qr-studio/releases) 取得正式版 EXE。
2. 在 64 位元 Windows 10／11 上開啟 EXE。程式使用 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。
3. 頂端可切換三個工具：
   - **條碼生成**：批次製作 CAMP168 商品 QR Code，或製作一維及二維條碼，個別匯出 PNG 或 SVG。
   - **改圖轉檔**：加入 JPG、PNG、BMP、TIFF、PSD 或 AI，輸出 1000 × 1000 白底 JPG，每張嚴格小於 500,000 bytes。一般格式、可讀的 PSD 合成影像與部分含 PDF 內容的 AI 在本機轉檔；其餘 AI 或 PSD 由對應的 Adobe 軟體處理。
   - **重新命名**：拖曳調整順序，設定檔名和編號，複製或移動到選定資料夾。可保留原格式或轉 JPG／PNG。

程式啟動時會向本儲存庫的 GitHub Releases 檢查正式版。新版需由使用者確認後才會下載及安裝。編碼、預覽、匯出和圖檔辨識皆在本機處理。

## 從原始碼建置

準備 Windows 上的 .NET Framework 4.8、PowerShell，以及 [Microsoft.Web.WebView2 1.0.2903.40 的 NuGet 套件](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.2903.40)。在儲存庫根目錄執行：

```powershell
./desktop/build.ps1 -WebView2Package 'C:/path/to/microsoft.web.webview2.1.0.2903.40.nupkg' -OutputPath './CAMP168-QR-1.8.0.exe'
```

發布時，GitHub 正式 Release 標籤使用 `v主版號.次版號.修訂號`，EXE 使用 `CAMP168-QR-主版號.次版號.修訂號.exe`，兩者須與 `desktop/Program.cs` 的組件版號一致。

第三方元件的授權請參閱 [dist/vendor](dist/vendor)。
