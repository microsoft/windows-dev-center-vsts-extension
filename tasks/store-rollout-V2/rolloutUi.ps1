[CmdletBinding()]
param()

Set-StrictMode -Version 2.0

try 
{
    [boolean]$useVerbose = $false
    if ([boolean]::TryParse($Env:SYSTEM_DEBUG, [ref]$useVerbose) -and $useVerbose)
    {
        $VerbosePreference = 'Continue'
    }
    Write-Verbose "Verbose preference has been set based on the presence of release variable 'System.Debug'"

    # Const
    Set-Variable -Name "NugetPath" -Value "$PSScriptRoot\ps_modules\NugetPackages" -Option Constant -Scope Local -Force

    Write-Output "Loading dependencies"
    Import-Module "$PSScriptRoot\ps_common\commonHelper.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null
    Import-Module "$PSScriptRoot\ps_common\storeBrokerHelper.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null
    Import-Module "$PSScriptRoot\ps_modules\StoreBroker" 6>$null 5>$null 4>$null 3>$null 1>$null
    Import-Module "$PSScriptRoot\ps_modules\VstsTaskSdk\VstsTaskSdk.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null
    Import-Module "$PSScriptRoot\rollout.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null

    Write-Output "Loading task inputs"
    [string]$appId = Get-VstsInput -Name "appId"
    [string]$appName = Get-VstsInput -Name "appName"
    [string]$appNameType = Get-VstsInput -Name "appNameType"
    [string]$currentPackageVersionRegex = Get-VstsInput -Name "currentPackageVersionRegex"
    [boolean]$disableTelemetry = Get-VstsInput -Name "disableTelemetry" -AsBool
    [string]$endpointId = Get-VstsInput -Name "serviceEndpoint"
    [boolean]$failIfNoRollout = Get-VstsInput -Name "failIfNoRollout" -AsBool
    [string]$flightId = Get-VstsInput -Name "flightId"
    [string]$flightName = Get-VstsInput -Name "flightName"
    [string]$flightNameType = Get-VstsInput -Name "flightNameType"
    [string]$logPath = Get-VstsInput -Name 'logPath'
    [string]$releaseTrack = Get-VstsInput -Name "releaseTrack"
    [float]$rollout = Get-VstsInput -Name "rollout"
    [string]$rolloutAction = Get-VstsInput -Name "rolloutAction"
    [float]$rolloutActionThreshold = Get-VstsInput -Name "rolloutActionThreshold"
    [boolean]$skipIfNoMatch = Get-VstsInput -Name "skipIfNoMatch" -AsBool

    Write-Verbose "Endpoint: $endpointId"
    $endPointObj = Get-VstsEndpoint -Name $endpointId -Require

    Write-Output "Setting Store Broker environment"
    Set-StoreBrokerSettings -LogPath $logPath -NugetPath $nugetPath -DisableTelemetry $disableTelemetry -Verbose:$useVerbose
    Set-StoreBrokerAuthCredentials -EndPointObj $endPointObj -Verbose:$useVerbose

    $taskParams = @{
        'AppId' = $appId
        'AppName' = $appName
        'AppNameType' = $appNameType
        'CurrentPackageVersionRegex' = $currentPackageVersionRegex
        'FailIfNoRollout' = $failIfNoRollout
        'FlightId' = $flightId
        'FlightName' = $flightName
        'FlightNameType' = $flightNameType
        'ReleaseTrack' = $releaseTrack
        'RolloutAction' = $rolloutAction
        'RolloutActionThreshold' = $rolloutActionThreshold
        'RolloutValue' = $rollout
        'SkipIfNoMatch' = $skipIfNoMatch
        'Verbose' = $useVerbose
    }

    Write-Output "Updating rollout"

    $result = Update-ProductRollout @taskParams

    Write-Output "Finished updating rollout"

    Write-Output "$($result.Message)"
    Write-VstsSetResult -Result "Succeeded" -Message $result.Message

    Write-Verbose "Only set output variables if a change was actually made"
    if ($result.ShouldPublishValues)
    {
        Write-Output "Populating out variables for future tasks to consume"
        # The varaible names have to match those defined in the task.json
        Write-Output "##vso[task.setvariable variable=EXISTING_ROLLOUT_PACKAGE_VERSION]$($result.Version)"
        Write-Output "##vso[task.setvariable variable=UPDATED_ROLLOUT_VALUE]$($result.RolloutValue)"
    }
    else 
    {
        Write-Output "The task has determined no change was made so the output variables won't be populated."
    }
}
catch
{
    Write-Error "$($_ | Out-String)"
}
finally
{
    if ((Test-Path variable:logPath) -and (Test-Path $logPath -PathType Leaf))
    {
        Write-Output "Attaching Store Broker log file $logPath. You can download it alongside the agent logs."
        Write-Output "##vso[task.uploadfile]$logPath"
    }
}