param([string]$NodeArchive)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ($version -ne '2.0.0') { throw 'Update launcher version, quickstart and build metadata together.' }
$nodeVersion = '24.22.1'
$archiveName = "node-v$nodeVersion-win-x64.zip"
$archiveHash = 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5'
$source = "https://nodejs.org/dist/v$nodeVersion/$archiveName"
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$stage = Join-Path $dist ('stage-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$packageName = "TextMask-$version-windows-x64"
$package = Join-Path $stage $packageName
New-Item -ItemType Directory -Force $package | Out-Null
try {
    if (!$NodeArchive) {
        $NodeArchive = Join-Path $dist $archiveName
        if (!(Test-Path -LiteralPath $NodeArchive)) {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest $source -OutFile $NodeArchive -UseBasicParsing
        }
    }
    $NodeArchive = (Resolve-Path -LiteralPath $NodeArchive).Path
    if ((Get-FileHash -LiteralPath $NodeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archiveHash) {
        throw 'Node archive SHA256 mismatch. Refusing to package it.'
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $nodeZip = [IO.Compression.ZipFile]::OpenRead($NodeArchive)
    try {
        New-Item -ItemType Directory -Force (Join-Path $package 'runtime') | Out-Null
        foreach ($file in @('node.exe','LICENSE')) {
            $entry = $nodeZip.GetEntry("node-v$nodeVersion-win-x64/$file")
            if (!$entry) { throw "Missing official runtime file: $file" }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $package "runtime/$file"))
        }
    } finally { $nodeZip.Dispose() }
    $app = Join-Path $package 'app'
    New-Item -ItemType Directory -Force (Join-Path $app 'scripts') | Out-Null
    foreach ($file in @('index.html','style.css','favicon.svg','server.js','package.json','THIRD_PARTY.md')) {
        Copy-Item -LiteralPath (Join-Path $root $file) -Destination $app
    }
    foreach ($folder in @('src','vendor')) {
        Copy-Item -LiteralPath (Join-Path $root $folder) -Destination $app -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $root 'scripts/portable-server.js') -Destination (Join-Path $app 'scripts')
    New-Item -ItemType Directory -Force (Join-Path $package 'examples') | Out-Null
    Copy-Item -LiteralPath (Join-Path $root 'examples/demo') -Destination (Join-Path $package 'examples') -Recurse
    Copy-Item -LiteralPath (Join-Path $root 'packaging/QUICKSTART.txt') -Destination (Join-Path $package 'START-HERE.txt')
    $license = Join-Path $root 'LICENSE'
    if (!(Test-Path -LiteralPath $license)) { throw 'The application MIT license must be present.' }
    Copy-Item -LiteralPath $license -Destination $package

    # Rasterize the project's own favicon geometry into a Windows application icon.
    Add-Type -AssemblyName System.Drawing
    $bitmap = New-Object Drawing.Bitmap 64,64
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([Drawing.Color]::FromArgb(37,77,213))
        $pen = New-Object Drawing.Pen ([Drawing.Color]::White),5
        $brush = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(184,183,250))
        try {
            $graphics.DrawLines($pen,[Drawing.Point[]]@([Drawing.Point]::new(24,17),[Drawing.Point]::new(17,17),[Drawing.Point]::new(17,47),[Drawing.Point]::new(24,47)))
            $graphics.DrawLines($pen,[Drawing.Point[]]@([Drawing.Point]::new(40,17),[Drawing.Point]::new(47,17),[Drawing.Point]::new(47,47),[Drawing.Point]::new(40,47)))
            $graphics.FillRectangle($brush,27,28,10,8)
        } finally { $pen.Dispose(); $brush.Dispose() }
        $icon = [Drawing.Icon]::FromHandle($bitmap.GetHicon())
        $iconPath = Join-Path $stage 'TextMask.ico'
        $iconFile = [IO.File]::Create($iconPath)
        try { $icon.Save($iconFile) } finally { $iconFile.Dispose(); $icon.Dispose() }
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    if (!(Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework C# compiler was not found.' }
    & $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/win32icon:$iconPath" "/win32manifest:$(Join-Path $root 'packaging/launcher.manifest')" "/out:$(Join-Path $package 'TextMask.exe')" (Join-Path $root 'packaging/Launcher.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
    @{
        application = 'TextMask'; version = $version; platform = 'windows-x64';
        runtime = @{ version = $nodeVersion; source = $source; archiveSha256 = $archiveHash; binarySha256 = (Get-FileHash (Join-Path $package 'runtime/node.exe') -Algorithm SHA256).Hash.ToLowerInvariant() }
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $package 'BUILD.json') -Encoding UTF8
    $fileHashes = Get-ChildItem -LiteralPath $package -Recurse -File | Sort-Object FullName | ForEach-Object {
        (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $_.FullName.Substring($package.Length + 1).Replace('\','/')
    }
    $fileHashes | Set-Content -LiteralPath (Join-Path $package 'FILES.sha256') -Encoding UTF8
    $zipPath = Join-Path $dist "$packageName.zip"
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath }
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, "$zipPath.tmp", [IO.Compression.CompressionLevel]::Optimal, $false)
    # Keep only the release folder, not the intermediate compiler icon.
    $zip = [IO.Compression.ZipFile]::Open("$zipPath.tmp", [IO.Compression.ZipArchiveMode]::Update)
    try { $zip.GetEntry('TextMask.ico').Delete() } finally { $zip.Dispose() }
    Move-Item -LiteralPath "$zipPath.tmp" -Destination $zipPath
    Write-Output "Built $zipPath"
    Get-FileHash -LiteralPath $zipPath -Algorithm SHA256 | Format-List
} finally {
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    if ($resolvedStage.StartsWith([IO.Path]::GetFullPath($dist) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    } else { throw 'Unsafe staging path; cleanup refused.' }
}
