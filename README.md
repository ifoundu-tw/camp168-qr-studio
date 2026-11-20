# CAMP168 QR／條碼工作台

由 yue 製作。Windows 單檔工具可批次產生 CAMP168 商品 QR Code，也可製作一維及二維條碼，並將每筆資料分別存成 PNG 或 SVG。

## 使用方式

1. 從 [GitHub Releases](https://github.com/ifoundu-tw/camp168-qr-studio/releases) 取得正式版 EXE。
2. 在 64 位元 Windows 10／11 上開啟 EXE。程式使用 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。
3. 在「商品批次」貼上尾綴，或在「條碼／Barcode」選擇碼種並輸入資料。選好樣式與格式後，點選匯出。

程式啟動時會向本儲存庫的 GitHub Releases 檢查正式版。新版需由使用者確認後才會下載及安裝。編碼、預覽、匯出和圖檔辨識皆在本機處理。

## 從原始碼建置

準備 Windows 上的 .NET Framework 4.8、PowerShell，以及 [Microsoft.Web.WebView2 1.0.2903.40 的 NuGet 套件](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.2903.40)。在儲存庫根目錄執行：

```powershell
./desktop/build.ps1 -WebView2Package 'C:/path/to/microsoft.web.webview2.1.0.2903.40.nupkg' -OutputPath './CAMP168-QR-1.8.0.exe'
```

發布時，GitHub 正式 Release 標籤使用 `v主版號.次版號.修訂號`，EXE 使用 `CAMP168-QR-主版號.次版號.修訂號.exe`，兩者須與 `desktop/Program.cs` 的組件版號一致。

第三方元件的授權請參閱 [dist/vendor](dist/vendor)。
