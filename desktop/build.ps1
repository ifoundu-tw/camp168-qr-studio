param(
    [Parameter(Mandatory)]
    [string] $WebView2Package,
    [string] $OutputPath = (Join-Path $PSScriptRoot '../../CAMP168-QR.exe'),
    [switch] $Qa
)
$ErrorActionPreference = 'Stop'
$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$sources = @('Program.cs','UpdateService.cs','ToolBridge.cs','MomoBatch.cs','PsdComposite.cs','AdobeRaster.cs','RenameBatch.cs','ImageSplit.cs') |
    ForEach-Object { Join-Path $PSScriptRoot $_ }
$dist = (Resolve-Path (Join-Path $PSScriptRoot '../dist')).Path
$output = [IO.Path]::GetFullPath($OutputPath)
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('camp168-sdk-' + [Guid]::NewGuid().ToString('N'))
$entries = [ordered]@{
    'lib/net462/Microsoft.Web.WebView2.Core.dll' = 'sdk.Microsoft.Web.WebView2.Core.dll'
    'lib/net462/Microsoft.Web.WebView2.WinForms.dll' = 'sdk.Microsoft.Web.WebView2.WinForms.dll'
    'runtimes/win-x64/native/WebView2Loader.dll' = 'sdk.WebView2Loader.dll'
    'LICENSE.txt' = 'sdk.LICENSE.txt'
    'NOTICE.txt' = 'sdk.NOTICE.txt'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Directory]::CreateDirectory($temporary) | Out-Null
try {
    $archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $WebView2Package).Path)
    $resources = @()
    $references = @(
        '/reference:System.dll,System.Core.dll,System.Drawing.dll,System.Windows.Forms.dll,System.Web.Extensions.dll,System.Net.Http.dll,Microsoft.CSharp.dll'
        "/reference:$(Join-Path $framework 'WPF/WindowsBase.dll')"
        "/reference:$(Join-Path $framework 'WPF/PresentationCore.dll')"
    )
    try {
        foreach ($record in $entries.GetEnumerator()) {
            $asset = $archive.GetEntry($record.Key)
            if ($null -eq $asset) { throw "SDK file is missing from package: $($record.Key)" }
            $file = Join-Path $temporary (Split-Path $record.Key -Leaf)
            [IO.Compression.ZipFileExtensions]::ExtractToFile($asset,$file)
            $resources += "/resource:$file,$($record.Value)"
            if ($record.Key -like 'lib/*') { $references += "/reference:$file" }
        }
    } finally { $archive.Dispose() }
    foreach ($asset in Get-ChildItem -LiteralPath $dist -File -Recurse) {
        $relative = $asset.FullName.Substring($dist.Length).Replace('\','/')
        $resources += "/resource:$($asset.FullName),ui$relative"
    }
    $options = @(
        '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/codepage:65001', "/out:$output"
    )
    if ($Qa) { $options += '/define:QA' }
    & (Join-Path $framework 'csc.exe') @options @references @resources @sources
    if ($LASTEXITCODE -ne 0) { throw "C# build failed with exit code $LASTEXITCODE" }
    Get-Item -LiteralPath $output
} finally {
    foreach ($asset in Get-ChildItem -LiteralPath $temporary -File) {
        [IO.File]::Delete($asset.FullName)
    }
    [IO.Directory]::Delete($temporary)
}
