param(
  [Parameter(Mandatory=$true)] [string]$TaskName,
  [Parameter(Mandatory=$true)] [string]$NodePath,
  [AllowEmptyString()] [string]$ScriptPath = "",
  [Parameter(Mandatory=$true)] [string]$ConfigDir,
  [Parameter(Mandatory=$true)] [string]$DataRoot,
  [Parameter(Mandatory=$true)] [string]$LogFile,
  [Parameter(Mandatory=$true)] [ValidateSet(1,2,4,8)] [int]$IntervalHours
)
$ErrorActionPreference = "Stop"
function Escape-Xml([string]$value) { return [System.Security.SecurityElement]::Escape($value) }
$argsList = @()
if ($ScriptPath) { $argsList += $ScriptPath }
$argsList += @("--wallpaper-once", "--config-dir", $ConfigDir, "--data-root", $DataRoot, "--log-file", $LogFile)
# A quoted path cannot contain a quote on Windows; preserve spaces and Unicode.
$arguments = ($argsList | ForEach-Object { '"' + $_ + '"' }) -join " "
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$boundary = (Get-Date).Date.ToString("yyyy-MM-ddTHH:mm:ss")
$subscription = "<QueryList><Query Id='0' Path='System'><Select Path='System'>*[System[Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1]]</Select></Query></QueryList>"
$xml = @"
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<Triggers>
  <CalendarTrigger><Enabled>true</Enabled><StartBoundary>$boundary</StartBoundary><Repetition><Interval>PT${IntervalHours}H</Interval><Duration>P1D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>
  <LogonTrigger><Enabled>true</Enabled><UserId>$(Escape-Xml $userId)</UserId></LogonTrigger>
  <EventTrigger><Enabled>true</Enabled><Subscription>$(Escape-Xml $subscription)</Subscription></EventTrigger>
</Triggers>
<Principals><Principal id="User"><UserId>$(Escape-Xml $userId)</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT5M</ExecutionTimeLimit><Enabled>true</Enabled></Settings>
<Actions Context="User"><Exec><Command>$(Escape-Xml $NodePath)</Command><Arguments>$(Escape-Xml $arguments)</Arguments><WorkingDirectory>$(Escape-Xml (Split-Path -Parent $NodePath))</WorkingDirectory></Exec></Actions>
</Task>
"@
Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
