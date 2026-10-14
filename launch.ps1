# HomeAuction Windows launcher: one visible terminal + hidden server/tunnel.
# An OS Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE cleans up subprocesses
# even when the terminal is closed with X (PowerShell finally may not run).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js was not found in PATH.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm was not found in PATH.' }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'npx was not found in PATH.' }
if (-not (Test-Path 'node_modules\socket.io\package.json')) {
    Write-Host 'Installing dependencies (npm ci)...' -ForegroundColor Yellow
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AuctionWindowsJob {
    [StructLayout(LayoutKind.Sequential)]
    public struct BasicLimitInfo {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public IntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct IoCounters {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct ExtendedLimits {
        public BasicLimitInfo BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
    public static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);
    [DllImport("kernel32.dll")]
    public static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll")]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);
    public static bool KillOnClose(IntPtr job) {
        var limits = new ExtendedLimits();
        limits.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        return SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits)));
    }
}
'@

$job = [AuctionWindowsJob]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero -or -not [AuctionWindowsJob]::KillOnClose($job)) {
    throw 'Windows Job Object could not be configured.'
}
# Place this supervisor in the job first, so every spawned descendant belongs
# to the same lifecycle. If a hosting terminal already owns a non-nestable job,
# also attempt direct child assignment and a taskkill /T fallback in finally.
$selfInJob = [AuctionWindowsJob]::AssignProcessToJobObject($job, [AuctionWindowsJob]::GetCurrentProcess())
$node = $null
$tunnel = $null
$logDirectory = Join-Path $env:TEMP ('HomeAuction_' + $PID)
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$nodeOut = Join-Path $logDirectory 'node-stdout.log'
$nodeErr = Join-Path $logDirectory 'node-stderr.log'
$tunnelOut = Join-Path $logDirectory 'tunnel-stdout.log'
$tunnelErr = Join-Path $logDirectory 'tunnel-stderr.log'
function Start-HiddenProcess([string]$command, [string]$stdout, [string]$stderr) {
    $p = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/s','/c', $command) `
        -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if (-not $selfInJob) { [void][AuctionWindowsJob]::AssignProcessToJobObject($job, $p.Handle) }
    return $p
}

try {
    Write-Host ''
    Write-Host '================ HomeAuction ================' -ForegroundColor Cyan
    Write-Host 'LOCAL:      http://localhost:3000' -ForegroundColor Green
    Write-Host 'Starting Node.js server and Cloudflare Tunnel...' -ForegroundColor Gray
    $node = Start-HiddenProcess 'node server.js' $nodeOut $nodeErr
    Start-Sleep -Seconds 2
    if ($node.HasExited) { throw 'Node.js stopped during startup. Check node-stderr.log.' }
    $tunnel = Start-HiddenProcess 'npx --yes cloudflared tunnel --url http://localhost:3000' $tunnelOut $tunnelErr
    Write-Host 'Waiting for public HTTPS address...' -ForegroundColor Yellow
    Write-Host 'Close this window to stop the server AND the tunnel.' -ForegroundColor Gray
    Write-Host '=============================================' -ForegroundColor Cyan
    $shown = ''
    $lastError = ''
    while ($true) {
        if ($node.HasExited) { throw 'Node.js server process stopped.' }
        if ($tunnel.HasExited) { throw 'Cloudflare Tunnel process stopped.' }
        foreach ($file in @($tunnelOut, $tunnelErr)) {
            if (-not (Test-Path $file)) { continue }
            $tail = Get-Content -LiteralPath $file -Tail 45 -ErrorAction SilentlyContinue
            $url = [regex]::Match(($tail -join "`n"), 'https://[a-z0-9-]+\.trycloudflare\.com\b')
            if ($url.Success -and $url.Value -ne $shown) {
                $shown = $url.Value
                Write-Host ''
                Write-Host ('PUBLIC:     ' + $shown) -ForegroundColor Green
                Write-Host 'LOCAL:      http://localhost:3000' -ForegroundColor Cyan
            }
        }
        if (-not $shown -and (Test-Path $tunnelErr)) {
            $errors = Get-Content -LiteralPath $tunnelErr -Tail 4 -ErrorAction SilentlyContinue
            $text = ($errors -join ' ')
            if ($text -match '(?i)(error|failed)' -and $text -ne $lastError) {
                Write-Host ('Tunnel status: ' + $text) -ForegroundColor Yellow
                $lastError = $text
            }
        }
        Start-Sleep -Milliseconds 900
    }
}
finally {
    Write-Host 'Stopping HomeAuction and tunnel...' -ForegroundColor Yellow
    foreach ($p in @($tunnel, $node)) {
        if ($null -eq $p) { continue }
        try { & taskkill.exe /PID $p.Id /T /F 2>$null | Out-Null } catch { }
    }
    if ($job -ne [IntPtr]::Zero) { [void][AuctionWindowsJob]::CloseHandle($job) }
    try { Remove-Item -LiteralPath $logDirectory -Recurse -Force -ErrorAction SilentlyContinue } catch { }
}
