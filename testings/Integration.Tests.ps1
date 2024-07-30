[CmdletBinding()]
param()
Set-StrictMode -Version 2.0
Write-Verbose "Check if write verbose works"
[boolean]$useVerbose = $($VerbosePreference -eq "Continue")
Set-Variable -Name "NugetPath" -Value "$PSScriptRoot\..\lib\ps_modules\NugetPackages" -Option Constant -Scope Local -Force
Set-Variable -Name "StoreBrokerPath" -Value "$PSScriptRoot\..\lib\ps_modules\StoreBroker" -Option Constant -Scope Local -Force
Set-Variable -Name "StoreBrokerHelperPath" -Value "$PSScriptRoot\..\tasks\ps_common\storeBrokerHelper.psm1" -Option Constant -Scope Local -Force
Set-Variable -Name "VstsHelperPath" -Value "$PSScriptRoot\..\tasks\ps_common\vstsHelper.psm1" -Option Constant -Scope Local -Force
Set-Variable -Name "CommonHelperPath" -Value "$PSScriptRoot\..\tasks\ps_common\commonHelper.psm1" -Option Constant -Scope Local -Force
Set-Variable -Name "StoreBrokerLogPath" -Value "$PSScriptRoot\..\sblogs\sblogs.txt" -Option Constant -Scope Local -Force

[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($StoreBrokerLogPath))

Import-Module "$PSScriptRoot\..\tasks\store-publish-V2\publish.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null
Import-Module $StoreBrokerPath 6>$null 5>$null 4>$null 3>$null 1>$null
Import-Module $StoreBrokerHelperPath 6>$null 5>$null 4>$null 3>$null 1>$null
Import-Module $VstsHelperPath 6>$null 5>$null 4>$null 3>$null 1>$null
Import-Module $CommonHelperPath 6>$null 5>$null 4>$null 3>$null 1>$null
Import-Module "$PSScriptRoot\..\lib\ps_modules\VstsTaskSdk\VstsTaskSdk.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null
Import-Module "$PSScriptRoot\..\tasks\store-rollout-V2\rollout.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null

$EndPointObj = @{
    'Auth' = @{
        'scheme' = 'UsernamePassword'
        'parameters' = @{
            # This is the tenant Id of Microsoft
            'tenantIdPassword' = '72f988bf-86f1-41af-91ab-2d7cd011db47'
            # This is the client ID of Azure Active Directory Service
            'username' = "f8c7a2d2-b9d1-4c63-988a-6e4cceb58b7e"
            # The password is available on MROKeyVault, for the key MROUniversalPublisherSecret
            'password' = "*********************************"
        }
    }
}

$EndPointObj = [PSCustomObject]$EndPointObj
Set-StoreBrokerSettings -LogPath $StoreBrokerLogPath -NugetPath $NugetPath -DisableTelemetry $false -EndPointObj $EndPointObj -Verbose:$useVerbose

function TestingRollout 
{
    [CmdletBinding()]
    param(
        [string] $appNameType,
        [string] $appId, 
        [string] $appName,
        [string] $currentPackageVersionRegex,
        [switch] $failIfNoRollout,
        [string] $flightId,
        [string] $flightName,
        [string] $flightNameType,
        [string] $releaseTrack,
        [string] $rollout,
        [string] $rolloutAction,
        [string] $rolloutActionThreshold
    )

    $taskParams = @{
        'AppId' = $AppId
        'AppNameType' = $appNameType
        'AppName' = $AppName
        'FlightId' = $FlightId
        'FlightName' = $FlightName
        'FlightNameType' = $FlightNameType
        'ReleaseTrack' = $ReleaseTrack
        'RolloutAction' = $rolloutAction
        'RolloutValue' = [float]::Parse($rollout)
        'RolloutActionThreshold' = [float]::Parse($rolloutActionThreshold)
        'CurrentPackageVersionRegex' = $currentPackageVersionRegex
        'FailIfNoRollout' = $failIfNoRollout
        'Verbose' = $useVerbose
    }

    Update-ProductRollout @taskParams
}

function PublishIntegrationTests
{
    $global:SBUseInt = $false
    $TestingWordNoUpdatesWithRollout = @{
        'AppNameType' = 'AppId'
        'AppId' = "9WZDNCRFJB9S"
        'ReleaseTrack' = 'Flight'
        'FlightNameType' = 'FlightName'
        'FlightName' = 'TestV2Api'
        'EndpointObject' = $EndPointObj
        'IsSparseBundle' = $false
        'Force' = $true
        'InputMethod' = 'Packages'
        'SourceFolder' = "\\o\tenants\FFD11231\16.0.11231.20008\Univ\latest\shadow\store\x86\ship\pkgmox_word\en-us"
        'Contents' = "word+(im|team|uap).appxbundle"
        'DeletePackages' = $true
        'NumberOfPackagesToKeep' = 0
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = "NoUpdate"
        'UpdateText' = $true
        'UpdateImages' = $false
        'UpdateVideos' = $false
        "CreateRollout" = $false
        'MinimumMetadata' = $true
        "StoreBrokerHelperPath" = $StoreBrokerHelperPath
        "StoreBrokerPath" = $StoreBrokerPath
        "NugetPath" = $NugetPath
        "DisableTelemetry" = $false
        'Verbose' = $useVerbose
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }

    $infoParams = @{
        'AppId' = "9WZDNCRFJB9S"
        'AppNameType' = 'AppId'
        'FlightId' = 'cd8eaa75-ed54-4766-99f6-e0f8dd6aa5af'
        'FlightNameType' = 'FlightId'
        'ReleaseTrack' = 'Flight'
        'Verbose' = $useVerbose
    }
    #$returnValues = Get-ProductIdAndFlightId @infoParams
    #$productId = $returnValues.ProductId
    #$submissionId = Start-Publishing @TestingWordNoUpdatesWithRollout
    #Start-SubmissionMonitor -Product $productId -SubmissionId $submissionID -Verbose:$True

    $global:SBUseInt = $false
    $TestingOHelloWorldReplacePackagesNoUpdates = @{
        'AppNameType' = 'AppId'
        'AppId' = "9WZDNCRD1LTH"
        'ReleaseTrack' = 'Production'
        'IsSparseBundle' = $false
        'Force' = $true
        'InputMethod' = 'Packages'
        'EndpointObject' = $EndPointObj
        'SourceFolder' = "\\osan\public\tianw\OHelloWorld"
        'Contents' = "16.0.10912.10000_ocanary+(im|team|uap)_none_ship_x86_en-us\*.appxbundle"
        'DeletePackages' = $true
        'NumberOfPackagesToKeep' = 0
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = "NoUpdate"
        'UpdateText' = $true
        'UpdateImages' = $false
        'UpdateVideos' = $false
        "CreateRollout" = $false
        'MinimumMetadata' = $true
        "StoreBrokerHelperPath" = $StoreBrokerHelperPath
        "StoreBrokerPath" = $StoreBrokerPath
        "NugetPath" = $NugetPath
        "DisableTelemetry" = $false
        'Verbose' = $useVerbose
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }
    #Start-Publishing @TestingOHelloWorldReplacePackagesNoUpdates

    $global:SBUseInt = $false
    $TestingOHelloWorldReplacePackagesUpdateListingAndVideos = @{
        'AppNameType' = 'AppId'
        'AppId' = "9WZDNCRD1LTH"
        'ReleaseTrack' = 'Production'
        'EndpointObject' = $EndPointObj
        'IsSparseBundle' = $false
        'Force' = $true
        'InputMethod' = 'Packages'
        'SourceFolder' = "\\osan\public\tianw\OHelloWorld"
        'Contents' = "16.0.10912.10000_ocanary+(im|team|uap)_none_ship_x86_en-us\*.appxbundle"
        'DeletePackages' = $true
        'NumberOfPackagesToKeep' = 0
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = "FolderStructure"
        'MetadataSource' = "\\osan\public\tianw\OCanaryMetadata"
        'UpdateText' = $true
        'UpdateImages' = $false
        'UpdateVideos' = $false
        "CreateRollout" = $false
        'MinimumMetadata' = $true
        "StoreBrokerHelperPath" = $StoreBrokerHelperPath
        "StoreBrokerPath" = $StoreBrokerPath
        "NugetPath" = $NugetPath
        "DisableTelemetry" = $false
        'Verbose' = $useVerbose
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }
    #Start-Publishing @TestingOHelloWorldReplacePackagesUpdateListingAndVideos

    $global:SBUseInt = $false
    $TestingOfficeHelperWithJsonAndZipPath = @{
        'AppNameType' = 'AppId'
        'AppId' = "9N1XVXWJ30RV"
        'ReleaseTrack' = 'Flight'
        'FlightNameType' = 'FlightId'
        'FlightId' = '1d028695-f78d-4d73-8e31-f36d3dca7f4c'
        'IsSparseBundle' = $false
        'Force' = $true
        'InputMethod' = 'JsonAndZip'
        'JsonPath' = '\\osan\public\tianw\OfficeHelperTesting\OfficeHelperSubmission.json'
        'ZipPath' = '\\osan\public\tianw\OfficeHelperTesting\OfficeHelperSubmission.zip'
        'DeletePackages' = $true
        'NumberOfPackagesToKeep' = 0
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = "NoUpdate"
        'Verbose' = $useVerbose
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }
    #Start-Publishing @TestingOfficeHelperWithJsonAndZipPath

    $global:SBUseInt = $false
    $TestingOHelloWolrdMetadataUpdates = @{
        'AppNameType' = 'AppId'
        'AppId' = "9WZDNCRD1LTH"
        'ReleaseTrack' = 'Production'
        'IsSparseBundle' = $false
        'Force' = $true
        'InputMethod' = 'Packages'
        'SourceFolder' = "\\osan\public\tianw\OHelloWorld"
        'Contents' = "16.0.10912.10000_ocanary+(im|team|uap)_none_ship_x86_en-us\*.appxbundle"
        'DeletePackages' = $true
        'NumberOfPackagesToKeep' = 0
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = "FolderStructure"
        'MetadataSource' = "\\osan\public\tianw\OCanaryMetadata"
        'UpdateImages' = $true
        'Rollout' = "0.5"
        "IsSeekEnabled" = $true 
        'Verbose' = $useVerbose
        "CreateRollout" = $false
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }
    #Start-Publishing @TestingOHelloWolrdMetadataUpdates

    $global:SBUseInt = $false
    $TestingOfficeLunchNoUpdate = @{
        'AppNameType' = 'AppId'
        'AppId' = "9P3VKBW97JJB"
        'ReleaseTrack' = "Production"
        'EndpointObject' = $EndPointObj
        'IsSparseBundle' = $true
        'Force' = $true
        'InputMethod' = 'Packages'
        'SourceFolder' = "\\osan\public\tianw\OfficeLunch"
        'Contents' = "9P3VKBW97JJB:16.0.11425.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\s.appxbundle`n9N32HHNSLTDJ:16.0.11425.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\access.appxbundle`n9PD5STSPTF96:16.0.11425.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\excel.appxbundle`n9PLBS005SMD2:16.0.11425.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\onenote.appxbundle`n9PB6DKJN3S3V:16.0.11425.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\outlook.appxbundle`n9MSVHD3F91ZL:16.0.11425.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\powerpoint.appxbundle`n9P8C69N37MF1:16.0.11425.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\project.appxbundle`n9MTPSSWLNGTV:16.0.11425.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\publisher.appxbundle`n9PMDSH92VDS3:16.0.11425.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\skype.appxbundle`n9N6PKK8FPLV0:16.0.11425.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\visio.appxbundle`n9NCWTGZ12QBW:16.0.11425.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\word.appxbundle"
        'DeletePackages' = $false
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = "NoUpdate"
        "StoreBrokerHelperPath" = $StoreBrokerHelperPath
        "StoreBrokerPath" = $StoreBrokerPath
        "NugetPath" = $NugetPath
        "DisableTelemetry" = $false
        "CreateRollout" = $false
        'Verbose' = $useVerbose
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }
    #Start-Publishing @TestingOfficeLunchNoUpdate

    $global:SBUseInt = $false
    $TestingOfficeLunchReplacePackages = @{
        'AppNameType' = 'AppId'
        'AppId' = "CFQ7TTC0K56C"
        'ReleaseTrack' = 'Flight'
        'FlightNameType' = 'FlightId'
        'FlightId' = '96f0c969-0bbc-4891-bbc2-4626d9cccbb8'
        'EndpointObject' = $EndPointObj
        'IsSparseBundle' = $true
        'Force' = $true
        'LogPath' = $StoreBrokerLogPath
        'InputMethod' = 'Packages'
        'SourceFolder' = 'G:\en-us'
        'Contents' = "CFQ7TTC0K56C:16.0.12026.20154_officecentennial*(rs3|rs4)_none_ship_x86_en-us\s.appxbundle`nCFQ7TTC0K5DN:16.0.12026.20154_officecentennial*(rs3|rs4)_none_ship_x86_en-us\access.appxbundle`nCFQ7TTC0K5F3:16.0.12026.20154_officecentennial*(rs3|rs4)_none_ship_x86_en-us\excel.appxbundle`nCFQ7TTC0K56B:16.0.12026.20154_officecentennial*(rs3|rs4)_none_ship_x86_en-us\onenote.appxbundle`nCFQ7TTC0K5CF:16.0.12026.20154_officecentennial*(rs3|rs4)_none_ship_x86_en-us\outlook.appxbundle`nCFQ7TTC0K5CT:16.0.12026.20154_officecentennial*(rs3|rs4)_none_ship_x86_en-us\powerpoint.appxbundle`nCFQ7TTC0K5CM:16.0.12026.20154_officecentennial*(rs3|rs4)_none_ship_x86_en-us\project.appxbundle`nCFQ7TTC0K5D0:16.0.12026.20154_officecentennial*(rs3|rs4)_none_ship_x86_en-us\publisher.appxbundle`nCFQ7TTC0K569:16.0.12026.20154_officecentennial*(rs3|rs4)_none_ship_x86_en-us\skype.appxbundle`nCFQ7TTC0K5CW:16.0.12026.20154_officecentennial*(rs3|rs4)_none_ship_x86_en-us\visio.appxbundle`nCFQ7TTC0K5D7:16.0.12026.20154_officecentennial*(rs3|rs4)_none_ship_x86_en-us\word.appxbundle"
        'DeletePackages' = $true
        'NumberOfPackagesToKeep' = 0
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = 'NoUpdate'
        "CreateRollout" = $false
        "StoreBrokerHelperPath" = $StoreBrokerHelperPath
        "StoreBrokerPath" = $StoreBrokerPath
        "NugetPath" = $NugetPath
        "DisableTelemetry" = $false
        'Verbose' = $useVerbose
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }

    $infoParams = @{
        'AppId' = "CFQ7TTC0K56C"
        'AppNameType' = 'AppId'
        'FlightId' = '96f0c969-0bbc-4891-bbc2-4626d9cccbb8'
        'FlightNameType' = 'FlightId'
        'ReleaseTrack' = 'Flight'
        'Verbose' = $useVerbose
    }
    #$returnValues = Get-ProductIdAndFlightId @infoParams
    #$productId = $returnValues.ProductId

    #$SubmissionCreated = $false
    #$RetryCount = 0
    #$submissionId = Start-Publishing @TestingOfficeLunchReplacePackages

    #Start-SubmissionMonitor -Product $productId -SubmissionId $submissionID -Verbose:$True -NoStatus

    $global:SBUseInt = $false
    $TestingOfficeCentennialReplacePackages = @{
        'AppNameType' = 'AppId'
        'AppId' = "CFQ7TTC0K56C"
        'ReleaseTrack' = 'Flight'
        'FlightNameType' = 'FlightId'
        'FlightId' = '96f0c969-0bbc-4891-bbc2-4626d9cccbb8'
        'EndpointObject' = $EndPointObj
        'IsSparseBundle' = $true
        'Force' = $true
        'LogPath' = $StoreBrokerLogPath
        'InputMethod' = 'Packages'
        'SourceFolder' = 'C:\Users\tianw\Desktop\centennial\en-us'
        'Contents' = "CFQ7TTC0K56C:16.0.12730.20174_officecentennial*(rs3|rs4)_none_ship_x86_en-us\s.appxbundle`nCFQ7TTC0K5DN:16.0.12730.20174_officecentennial*(rs3|rs4)_none_ship_x86_en-us\access.appxbundle`nCFQ7TTC0K5F3:16.0.12730.20174_officecentennial*(rs3|rs4)_none_ship_x86_en-us\excel.appxbundle`nCFQ7TTC0K56B:16.0.12730.20174_officecentennial*(rs3|rs4)_none_ship_x86_en-us\onenote.appxbundle`nCFQ7TTC0K5CF:16.0.12730.20174_officecentennial*(rs3|rs4)_none_ship_x86_en-us\outlook.appxbundle`nCFQ7TTC0K5CT:16.0.12730.20174_officecentennial*(rs3|rs4)_none_ship_x86_en-us\powerpoint.appxbundle`nCFQ7TTC0K5CM:16.0.12730.20174_officecentennial*(rs3|rs4)_none_ship_x86_en-us\project.appxbundle`nCFQ7TTC0K5D0:16.0.12730.20174_officecentennial*(rs3|rs4)_none_ship_x86_en-us\publisher.appxbundle`nCFQ7TTC0K569:16.0.12730.20174_officecentennial*(rs3|rs4)_none_ship_x86_en-us\skype.appxbundle`nCFQ7TTC0K5CW:16.0.12730.20174_officecentennial*(rs3|rs4)_none_ship_x86_en-us\visio.appxbundle`nCFQ7TTC0K5D7:16.0.12730.20174_officecentennial*(rs3|rs4)_none_ship_x86_en-us\word.appxbundle"
        'DeletePackages' = $true
        'NumberOfPackagesToKeep' = 0
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = 'NoUpdate'
        "CreateRollout" = $false
        "StoreBrokerHelperPath" = $StoreBrokerHelperPath
        "StoreBrokerPath" = $StoreBrokerPath
        "NugetPath" = $NugetPath
        "DisableTelemetry" = $false
        'Verbose' = $useVerbose
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }

    $infoParams = @{
        'AppId' = "CFQ7TTC0K56C"
        'AppNameType' = 'AppId'
        'FlightId' = '96f0c969-0bbc-4891-bbc2-4626d9cccbb8'
        'FlightNameType' = 'FlightId'
        'ReleaseTrack' = 'Flight'
        'Verbose' = $useVerbose
    }
    $returnValues = Get-ProductIdAndFlightId @infoParams
    $productId = $returnValues.ProductId

    $SubmissionCreated = $false
    $RetryCount = 0
    $submissionId = Start-Publishing @TestingOfficeCentennialReplacePackages

    Start-SubmissionMonitor -Product $productId -SubmissionId $submissionID -Verbose:$True -NoStatus

    $global:SBUseInt = $false
    $TestingOfficeLunchUpdatePackages = @{
        'AppNameType' = 'AppId'
        'AppId' = "9P3VKBW97JJB"
        'ReleaseTrack' = "Production"
        'IsSparseBundle' = $true
        'Force' = $true
        'InputMethod' = 'Packages'
        'SourceFolder' = "\\osan\public\tianw\OfficeLunch"
        'Contents' = "9P3VKBW97JJB:16.0.11029.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\s.appxbundle`n9N32HHNSLTDJ:16.0.11029.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\access.appxbundle`n9PD5STSPTF96:16.0.11029.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\excel.appxbundle`n9PLBS005SMD2:16.0.11029.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\onenote.appxbundle`n9PB6DKJN3S3V:16.0.11029.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\outlook.appxbundle`n9MSVHD3F91ZL:16.0.11029.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\powerpoint.appxbundle`n9P8C69N37MF1:16.0.11029.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\project.appxbundle`n9MTPSSWLNGTV:16.0.11029.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\publisher.appxbundle`n9PMDSH92VDS3:16.0.11029.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\skype.appxbundle`n9N6PKK8FPLV0:16.0.11029.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\visio.appxbundle`n9NCWTGZ12QBW:16.0.11029.10000_officecentennial*(rs3|rs4)lunch_none_ship_x+(86|64)_en-us\word.appxbundle"
        'DeletePackages' = $true
        'NumberOfPackagesToKeep' = 2
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = "NoUpdate"
        "CreateRollout" = $false
        "StoreBrokerHelperPath" = $StoreBrokerHelperPath
        "StoreBrokerPath" = $StoreBrokerPath
        "NugetPath" = $NugetPath
        "DisableTelemetry" = $false
        'Verbose' = $useVerbose
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }
    #Start-Publishing @TestingOfficeLunchUpdatePackages

    $global:SBUseInt = $true
    $TestingOneNoteUpdatePackages = @{
        'AppNameType' = 'AppId'
        'AppId' = "9WZDNCRFHVJL"
        'ReleaseTrack' = "Production"
        'IsSparseBundle' = $false
        'Force' = $true
        'InputMethod' = 'Packages'
        'SourceFolder' = "\\o\tenants\FFD10803\16.0.10803.20003\Univ\latest\shadow\store\x86\ship\pkgmox_onenote\en-us"
        'Contents' = "onenote+(im|team|uap).appxbundle"
        'DeletePackages' = $true
        'NumberOfPackagesToKeep' = 2
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = "NoUpdate"
        'Verbose' = $useVerbose
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }
    #Start-Publishing @TestingOneNoteUpdatePackages

    $global:SBUseInt = $true
    $TestingOneNoteMetadataUpdateImages = @{
        'AppNameType' = 'AppId'
        'AppId' = "9WZDNCRFHVJL"
        'ReleaseTrack' = "Production"
        'IsSparseBundle' = $false
        'Force' = $true
        'InputMethod' = 'Packages'
        'SourceFolder' = "\\o\tenants\FFD10803\16.0.10803.20003\Univ\latest\shadow\store\x86\ship\pkgmox_onenote\en-us"
        'Contents' = "onenote+(im|team|uap).appxbundle"
        'DeletePackages' = $false
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = "FolderStructure"
        'MetadataSource' = "\\osan\public\tianw\OnenoteMetadata"
        'UpdateImages' = $true
        'UpdateVideos' = $true
        'Verbose' = $useVerbose
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }
    #Start-Publishing @TestingOneNoteMetadataUpdateImages

    $global:SBUseInt = $true
    $TestingOneNoteMetadataUpdateWithPDP = @{
        'AppNameType' = 'AppId'
        'AppId' = "9WZDNCRFHVJL"
        'ReleaseTrack' = "Production"
        'IsSparseBundle' = $false
        'Force' = $true
        'InputMethod' = 'Packages'
        'SourceFolder' = "\\o\tenants\FFD10803\16.0.10803.20003\Univ\latest\shadow\store\x86\ship\pkgmox_onenote\en-us"
        'Contents' = "onenote+(im|team|uap).appxbundle"
        'DeletePackages' = $false
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = "PDPFile"
        'PdpPath' = ""
        'Verbose' = $useVerbose
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }
    #Start-Publishing @TestingOneNoteMetadataUpdateWithPDP
}

function RolloutIntegrationTests
{
    $global:SBUseInt = $false
    $TestingOHelloWorldRolloutSet50 = @{
        'appNameType' = 'AppId'
        'appId' = '9WZDNCRD1LTH'
        'currentPackageVersionRegex' = '160\d\d\.10912\.10000\.0'
        'failIfNoRollout' = $true
        'releaseTrack' = 'Production'
        'rollout' = '50.0'
        'rolloutAction' = 'set'
        'rolloutActionThreshold' = '100.0'
        'Verbose' = $useVerbose
    }

    TestingRollout @TestingOHelloWorldRolloutSet50

    $global:SBUseInt = $false
    $TestingOHelloWorldRolloutFinalize = @{
        'appNameType' = 'AppId'
        'appId' = '9WZDNCRD1LTH'
        'currentPackageVersionRegex' = '160\d\d\.10912\.10000\.0'
        'failIfNoRollout' = $true
        'releaseTrack' = 'Production'
        'rollout' = '100.0'
        'rolloutAction' = 'set'
        'rolloutActionThreshold' = '1.0'
        'Verbose' = $useVerbose
    }
    TestingRollout @TestingOHelloWorldRolloutFinalize

    $global:SBUseInt = $false
    $TestingOHelloWorldRolloutRollback = @{
        'appNameType' = 'AppId'
        'appId' = '9WZDNCRD1LTH'
        'currentPackageVersionRegex' = '160\d\d\.10912\.10000\.0'
        'failIfNoRollout' = $true
        'releaseTrack' = 'Production'
        'rollout' = '90.0'
        'rolloutAction' = 'finalize'
        'rolloutActionThreshold' = '99.0'
        'Verbose' = $useVerbose
    }
    TestingRollout @TestingOHelloWorldRolloutRollback
}

# This is testing the case when calling rollout immediately after a submission is published
# The rollout should not continue since there are 2 submissions on the store
function PublishThenRolloutTestOHelloWorld
{
    $global:SBUseInt = $false
    $TestingOHelloWorldPublishing = @{
        'AppNameType' = 'AppId'
        'AppId' = "9WZDNCRD1LTH"
        'ReleaseTrack' = 'Production'
        'IsSparseBundle' = $false
        'Force' = $true
        'InputMethod' = 'Packages'
        'EndpointObject' = $EndPointObj
        'SourceFolder' = "\\osan\public\tianw\OHelloWorld"
        'Contents' = "16.0.10912.10000_ocanary+(im|team|uap)_none_ship_x86_en-us\*.appxbundle"
        'DeletePackages' = $true
        'NumberOfPackagesToKeep' = 0
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = "NoUpdate"
        'Verbose' = $useVerbose
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }
    $infoParams = @{
        'AppId' = "9WZDNCRD1LTH"
        'AppNameType' = 'AppId'
        'ReleaseTrack' = 'Production'
        'Verbose' = $useVerbose
    }
    $returnValues = Get-ProductIdAndFlightId @infoParams
    $productId = $returnValues.ProductId
    $submissionId = Start-Publishing @TestingOHelloWorldPublishing
    #Start-SubmissionMonitor -Product $productId -SubmissionId $submissionID -Verbose:$True

    $TestingOHelloWorldRollout = @{
        'appNameType' = 'AppId'
        'appId' = '9WZDNCRD1LTH'
        'currentPackageVersionRegex' = '160\d\d\.10912\.10000\.0'
        'failIfNoRollout' = $false
        'releaseTrack' = 'Production'
        'rollout' = '50.0'
        'rolloutAction' = 'set'
        'rolloutActionThreshold' = '100.0'
        'Verbose' = $useVerbose
    }
    TestingRollout @TestingOHelloWorldRollout
}

function PublishWithRolloutThenRolloutTestOHelloWorld
{
    $global:SBUseInt = $false
    $TestingOHelloWorldPublishing = @{
        'AppNameType' = 'AppId'
        'AppId' = "9WZDNCRD1LTH"
        'ReleaseTrack' = 'Production'
        'IsSparseBundle' = $false
        'Force' = $true
        'InputMethod' = 'Packages'
        'EndpointObject' = $EndPointObj
        'SourceFolder' = "\\osan\public\tianw\OHelloWorld"
        'Contents' = "16.0.10912.10000_ocanary+(im|team|uap)_none_ship_x86_en-us\*.appxbundle"
        'DeletePackages' = $true
        'NumberOfPackagesToKeep' = 0
        'IsMandatoryUpdate' = $false
        'MetadataUpdateMethod' = "NoUpdate"
        'CreateRollout' = $true
        'rollout' = 50.0
        'isSeekEnabled' = $true
        'Verbose' = $useVerbose
        'TargetPublishMode' = 'Default'
        'TargetPublishDate' = ''
        'Visibility' = 'Default'
    }
    $infoParams = @{
        'AppId' = "9WZDNCRD1LTH"
        'AppNameType' = 'AppId'
        'ReleaseTrack' = 'Production'
        'Verbose' = $useVerbose
    }
    $returnValues = Get-ProductIdAndFlightId @infoParams
    $productId = $returnValues.ProductId
    $submissionId = Start-Publishing @TestingOHelloWorldPublishing
    Start-SubmissionMonitor -Product $productId -SubmissionId $submissionID -Verbose:$True -NoStatus

    $TestingOHelloWorldRollout = @{
        'appNameType' = 'AppId'
        'appId' = '9WZDNCRD1LTH'
        'currentPackageVersionRegex' = '160\d\d\.10912\.10000\.0'
        'failIfNoRollout' = $false
        'releaseTrack' = 'Production'
        'rollout' = '20.0'
        'rolloutAction' = 'set'
        'rolloutActionThreshold' = '100.0'
        'Verbose' = $useVerbose
    }
    TestingRollout @TestingOHelloWorldRollout
}

PublishIntegrationTests
#RolloutIntegrationTests
#PublishThenRolloutTestOHelloWorld
#PublishWithRolloutThenRolloutTestOHelloWorld