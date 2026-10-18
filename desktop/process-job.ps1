param([Parameter(Mandatory=$true)][int]$ProcessId)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class HomeAuctionProcessJob {
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

    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr handle);

    public static bool SetKillOnClose(IntPtr job, bool enabled) {
        var limits = new ExtendedLimits();
        limits.BasicLimitInformation.LimitFlags = enabled ? (uint)0x2000 : 0u;
        return SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits)));
    }
}
'@

$job = [HomeAuctionProcessJob]::CreateJobObject([IntPtr]::Zero, $null)
$process = [HomeAuctionProcessJob]::OpenProcess(0x00100101, $false, [uint32]$ProcessId)
if ($job -eq [IntPtr]::Zero -or $process -eq [IntPtr]::Zero) {
    throw 'Could not open a Windows Job Object or the HomeAuction process.'
}

try {
    if (-not [HomeAuctionProcessJob]::SetKillOnClose($job, $true)) {
        throw 'Could not enable JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.'
    }
    if (-not [HomeAuctionProcessJob]::AssignProcessToJobObject($job, $process)) {
        throw 'Windows refused to assign HomeAuction to the process Job Object.'
    }

    [Console]::Out.WriteLine('JOB_READY')
    $command = $null
    do {
        $command = [Console]::In.ReadLine()
    } while ($null -ne $command -and $command -ne 'DISARM')

    if ($command -eq 'DISARM') {
        if (-not [HomeAuctionProcessJob]::SetKillOnClose($job, $false)) {
            throw 'Could not disable JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE for a graceful exit.'
        }
        [Console]::Out.WriteLine('JOB_DISARMED')
    }
}
finally {
    if ($process -ne [IntPtr]::Zero) { [void][HomeAuctionProcessJob]::CloseHandle($process) }
    if ($job -ne [IntPtr]::Zero) { [void][HomeAuctionProcessJob]::CloseHandle($job) }
}
