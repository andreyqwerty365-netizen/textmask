param([Parameter(Mandatory=$true)][string]$PackageRoot)
$ErrorActionPreference = 'Stop'
$launcher = Join-Path (Resolve-Path -LiteralPath $PackageRoot) 'TextMask.exe'
if (!(Test-Path -LiteralPath $launcher)) { throw 'Missing portable launcher: build the Windows package first.' }
$url = 'http://127.0.0.1:4175/'
$checks = 0
function Assert-Check($condition, $name) {
    if (!$condition) { throw $name }
    $script:checks++
    Write-Output "PASS $name"
}
function Wait-Server($expected) {
    for ($i=0; $i -lt 100; $i++) {
        $running = $false
        try { $running = (Invoke-WebRequest $url -TimeoutSec 1 -UseBasicParsing).StatusCode -eq 200 } catch { }
        if ($running -eq $expected) { return $true }
        Start-Sleep -Milliseconds 100
    }
    return $false
}
# Never stop an existing user-owned instance to make room for the smoke test.
try { $null = Invoke-WebRequest $url -TimeoutSec 1 -UseBasicParsing; throw 'Port 4175 is already in use; stop your own instance before testing.' }
catch { if ($_.Exception.Message -like 'Port 4175*') { throw } }
$process = $null
try {
    $process = Start-Process -FilePath $launcher -ArgumentList '--background' -WindowStyle Hidden -PassThru
    Assert-Check (Wait-Server $true) 'bundled server starts without a shell window'
    $listeners = Get-NetTCPConnection -LocalPort 4175 -State Listen
    Assert-Check (@($listeners | Where-Object LocalAddress -ne '127.0.0.1').Count -eq 0) 'server listens on loopback only'
    $ownerId = @($listeners)[0].OwningProcess
    $duplicate = Start-Process -FilePath $launcher -ArgumentList '--background' -WindowStyle Hidden -PassThru
    $duplicate.WaitForExit(5000) | Out-Null
    Assert-Check ($duplicate.HasExited -and $duplicate.ExitCode -eq 0) 'second launch reuses the running instance'
    Assert-Check ((Get-NetTCPConnection -LocalPort 4175 -State Listen).OwningProcess -eq $ownerId) 'second launch leaves the same server process'
    $stop = Start-Process -FilePath $launcher -ArgumentList '--stop' -WindowStyle Hidden -PassThru -Wait
    Assert-Check ($stop.ExitCode -eq 0 -and (Wait-Server $false)) 'stop command closes the owned server'
    $process.WaitForExit(5000) | Out-Null
    Assert-Check ($process.HasExited -and $process.ExitCode -eq 0) 'launcher exits cleanly'
    $process = Start-Process -FilePath $launcher -ArgumentList '--background' -WindowStyle Hidden -PassThru
    Assert-Check (Wait-Server $true) 'portable app restarts after a clean stop'
    Stop-Process -Id $process.Id
    Assert-Check (Wait-Server $false) 'launcher crash closes child server through the stdin pipe'
    $process = $null
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 4175)
    $listener.Start()
    try {
        $busy = Start-Process -FilePath $launcher -ArgumentList '--background' -WindowStyle Hidden -PassThru
        $busy.WaitForExit(20000) | Out-Null
        Assert-Check ($busy.HasExited -and $busy.ExitCode -eq 4) 'occupied port returns a clear launch failure'
        Assert-Check ($listener.Server.IsBound) 'occupied port owner stays alive'
    } finally { $listener.Stop() }
    Write-Output "Windows portable: $checks checks passed."
} finally {
    if ($process -and !$process.HasExited) {
        Start-Process -FilePath $launcher -ArgumentList '--stop' -WindowStyle Hidden -Wait
    }
}
