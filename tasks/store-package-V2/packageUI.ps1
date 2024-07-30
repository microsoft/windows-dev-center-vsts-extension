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

    Write-Output "Loading task inputs"
    [string]$appId = Get-VstsInput -Name "appId"
    [string]$appName = Get-VstsInput -Name "appName"
    [string]$appNameType = Get-VstsInput -Name "appNameType"
    [string]$contents = Get-VstsInput -Name "contents"
    [boolean]$disableTelemetry = Get-VstsInput -Name "disableTelemetry" -AsBool
    [string]$endpointId = Get-VstsInput -Name "serviceEndpoint"
    [string]$languageExclude = Get-VstsInput -Name "languageExclude"
    [string]$logPath = Get-VstsInput -Name 'logPath'
    [string]$outSBName = Get-VstsInput -Name "outSBName"
    [string]$outSBPackagePath = Get-VstsInput -Name "outSBPackagePath"
    [string]$pdpInclude = Get-VstsInput -Name "pdpInclude"
    [string]$pdpMediaPath = Get-VstsInput -Name "pdpMediaPath"
    [string]$pdpPath = Get-VstsInput -Name "pdpPath"
    [string]$sbConfigPath = Get-VstsInput -Name "sbConfigPath"
    [string]$sourceFolder = Get-VstsInput -Name "sourceFolder"

    $endPointObj = Get-VstsEndpoint -Name $endpointId -Require

    Write-Output "Setting Store Broker environment"
    Set-StoreBrokerSettings -LogPath $logPath -NugetPath $nugetPath -DisableTelemetry $disableTelemetry -Verbose:$useVerbose
    Set-StoreBrokerAuthCredentials -EndPointObj $endPointObj -Verbose:$useVerbose

    Write-Output "Creating new Submission package in $outSBPackagePath with common name $outSBName"

    if ($appNameType -eq 'AppName')
    {
        Write-Verbose "Getting AppId for AppName: $appName"
        $appId = Get-AppIdFromAppName -AppName $appName
    }

    $pdpInclude = $pdpInclude.Replace('`r`n', '`n').Replace('`r', '`n').Split('`n', [System.StringSplitOptions]::RemoveEmptyEntries)
    $languageExclude = $languageExclude.Replace('`r`n', '`n').Replace('`r', '`n').Split('`n', [System.StringSplitOptions]::RemoveEmptyEntries)

    $packages = @()
    if (-not ([string]::IsNullOrWhiteSpace($sourceFolder)))
    {
        Write-Output "Source Folder of packages: $sourceFolder"

        # Normalize new line to LF
        $contents = $contents.Replace("`r`n","`n")
        $contents = $contents.Replace("`r","`n")
        $contentsList = $contents.Split("`n")

        foreach($content in $contentsList) {
            $pkgFiles = Find-Match -DefaultRoot $sourceFolder -Pattern $content
            foreach ($pkg in $pkgFiles) {
                $packages += $pkg
            }
        }

        Write-Output "Package paths after parsing mini-match pattern:"
        Write-Output $packages
    }

    Write-Output "PDP Root path: $pdpPath"
    if ([string]::IsNullOrWhiteSpace($sbConfigPath))
    {
        Write-Output "No config file was provided, creating new one"
        $null = New-Item -ItemType Directory -Path $outSBPackagePath -Force
        $sbConfigPath = [IO.Path]::Combine($outSBPackagePath, 'SBConfig.json')
        $null = New-StoreBrokerConfigFile -Path $sbConfigPath -AppId $appId -Verbose:$useVerbose
    }

    $newSubmissionPackageParams = @{
        'ConfigPath' = $sbConfigPath
        'PackagePath' = $packages
        'PDPInclude' = $pdpInclude
        'LanguageExclude' = $languageExclude
        'OutPath' = $outSBPackagePath
        'OutName' = $outSBName
        'Verbose' = $useVerbose
    }

    if (-not [string]::IsNullOrWhiteSpace($pdpMediaPath))
    {
        $newSubmissionPackageParams['MediaRootPath'] = $pdpMediaPath
    }

    if (-not [string]::IsNullOrWhiteSpace($pdpPath))
    {
        $newSubmissionPackageParams['PDPRootPath'] = $pdpPath
    }

    Write-Output "Calling Store Broker to create a new submission Package"
    $null = New-SubmissionPackage @newSubmissionPackageParams
    Write-Output "Finished creating new submission pacakge"
    Write-VstsSetResult -Result "Succeeded" -Message "Finished creating new submission pacakge"
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