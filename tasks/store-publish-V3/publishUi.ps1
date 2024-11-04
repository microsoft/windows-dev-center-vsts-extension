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
    Set-Variable -Name "NugetPath" -Value "$PSScriptRoot\ps_modules\NugetPackages" -Option Constant -Scope Global -Force
    Set-Variable -Name "OpenSSLPath" -Value "$PSScriptRoot\ps_modules\openssl" -Option Constant -Scope Global -Force
    Set-Variable -Name "StoreBrokerPath" -Value "$PSScriptRoot\ps_modules\StoreBroker" -Option Constant -Scope Local -Force
    Set-Variable -Name "StoreBrokerHelperPath" -Value "$PSScriptRoot\ps_common\storeBrokerHelper.psm1" -Option Constant -Scope Local -Force
    # This value has to map the name of the out variable defined in the task.json
    Set-Variable -Name "OutSubmissionIdVariableName" -Value "WS_SubmissionId" -Option Constant -Scope Local -Force

    Write-Output "Loading dependencies"
    Import-Module "$PSScriptRoot\ps_common\commonHelper.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null
    Import-Module "$PSScriptRoot\ps_common\vstsHelper.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null
    Import-Module "$PSScriptRoot\publish.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null
    Import-Module $StoreBrokerPath 6>$null 5>$null 4>$null 3>$null 1>$null
    Import-Module $StoreBrokerHelperPath 6>$null 5>$null 4>$null 3>$null 1>$null
    Import-Module "$PSScriptRoot\ps_modules\VstsTaskSdk\VstsTaskSdk.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null
    Import-Module "$PSScriptRoot\ps_modules\AdoAzureHelper\AdoAzureHelper.psm1" 6>$null 5>$null 4>$null 3>$null 1>$null

    Write-Output "Loading task inputs"
    [string]$appId = Get-VstsInput -Name "appId"
    [string]$appName = Get-VstsInput -Name "appName"
    [string]$appNameType = Get-VstsInput -Name "appNameType"
    [string]$contents = Get-VstsInput -Name "contents"
    [boolean]$createRollout = Get-VstsInput -Name "createRollout" -AsBool
    [boolean]$deletePackages = Get-VstsInput -Name "deletePackages" -AsBool
    [boolean]$disableTelemetry = Get-VstsInput -Name "disableTelemetry" -AsBool
    [string]$endpointId = Get-VstsInput -Name "serviceEndpoint"
    [string]$flightId = Get-VstsInput -Name "flightId"
    [string]$flightName = Get-VstsInput -Name "flightName"
    [string]$flightNameType = Get-VstsInput -Name "flightNameType"
    [string]$sandboxId = Get-VstsInput -Name "sandboxId"
    [boolean]$force = Get-VstsInput -Name "force" -AsBool
    [boolean]$isSeekEnabled = Get-VstsInput -Name "isSeekEnabled" -AsBool
    [boolean]$isSparseBundle = Get-VstsInput -Name "isSparseBundle" -AsBool
    [boolean]$isMandatoryUpdate = Get-VstsInput -Name "isMandatoryUpdate" -AsBool
    [string]$inputMethod = Get-VstsInput -Name "inputMethod"
    [string]$jsonPath = Get-VstsInput -Name "jsonPath"
    [boolean]$jsonZipUpdateMetadata = Get-VstsInput -Name "jsonZipUpdateMetadata" -AsBool
    [string]$logPath = Get-VstsInput -Name "logPath"
    [int]$mandatoryUpdateDifferHours = Get-VstsInput -Name "mandatoryUpdateDifferHours" -AsInt
    [string]$metadataUpdateMethod = Get-VstsInput -Name "metadataUpdateMethod"
    [string]$metadataSource = Get-VstsInput -Name "metadataPath"
    [boolean]$minimumMetadata = Get-VstsInput -Name "minimumMetadata" -AsBool
    [int]$numberOfPackagesToKeep = Get-VstsInput -Name "numberOfPackagesToKeep" -AsInt
    [boolean]$preserveSubmissionId = Get-VstsInput -Name "preserveSubmissionId" -AsBool
    [string]$releaseTrack = Get-VstsInput -Name "releaseTrack"
    [string]$rollout = Get-VstsInput -Name "rollout"
    [string]$existingPackageRolloutAction = Get-VstsInput -Name "existingPackageRolloutAction"
    [boolean]$skipPolling = Get-VstsInput -Name "skipPolling" -AsBool
    [string]$sourceFolder = Get-VstsInput -Name "sourceFolder"
    [string]$targetPublishMode = Get-VstsInput -Name "targetPublishMode"
    [string]$targetPublishDate = Get-VstsInput -Name "targetPublishDate"
    [boolean]$updateImages = Get-VstsInput -Name "updateImages" -AsBool
    [boolean]$updateVideos = Get-VstsInput -Name "updateVideos" -AsBool
    [boolean]$updateText = Get-VstsInput -Name "updateText" -AsBool
    [boolean]$updatePublishModeAndVisibility = Get-VstsInput -Name "updatePublishModeAndVisibility" -AsBool
    [boolean]$updatePricingAndAvailability = Get-VstsInput -Name "updatePricingAndAvailability" -AsBool
    [boolean]$updateAppProperties = Get-VstsInput -Name "updateAppProperties" -AsBool
    [boolean]$updateGamingOptions = Get-VstsInput -Name "updateGamingOptions" -AsBool
    [boolean]$updateNotesForCertification = Get-VstsInput -Name "updateNotesForCertification" -AsBool
    [string]$visibility = Get-VstsInput -Name "visibility"
    [string]$zipPath = Get-VstsInput -Name "zipPath"

    $endPointObj = Get-VstsEndpoint -Name $endpointId -Require

    Write-Output "Setting Store Broker environment"
    Set-StoreBrokerSettings -LogPath $logPath -NugetPath $NugetPath -DisableTelemetry $disableTelemetry -Verbose:$useVerbose

    # Getting AAD accessToken that would be later used by all the StoreBroker commands to access Partner Center APIs.
    Initialize-AdoAzureHelper -msalLibraryDir $NugetPath -adoApiLibraryDir $NugetPath -openSSLExeDir $OpenSSLPath
    $resource = "https://api.partner.microsoft.com"

    $sendX5C = $true
    $useMSAL = $true
    if (($endPointObj.Auth.Scheme -eq 'WorkloadIdentityFederation') -or ($endPointObj.Auth.Parameters.AuthenticationType -ne 'SPNCertificate'))
    {
        $sendX5C = $false
    }

    $aadAccessToken = (Get-AzureRMAccessToken $endPointObj $endpointId $resource $sendX5C $useMSAL).access_token

    $commonParams = @{
        'AppId' = $appId
        'AppName' = $appName
        'AppNameType' = $appNameType
        'FlightId' = $flightId
        'FlightName' = $flightName
        'FlightNameType' = $flightNameType
        'SandboxId' = $sandboxId
        'ReleaseTrack' = $releaseTrack
        'AccessToken' = $aadAccessToken
        'Verbose' = $useVerbose
    }

    # Because there could be multiple flight tasks running at the same time, we need to store the submission IDs into multiple variables
    # Therefore we append the flight name or id to the end of the submissionIdVariableName
    $submissionIdVariableName = $OutSubmissionIdVariableName
    if ($releaseTrack -eq 'Production')
    {
        $submissionIdVariableName = "WS_SubmissionId_Prod"
    }
    elseif ($releaseTrack -eq 'Sandbox')
    {
        $submissionIdVariableName = "WS_SubmissionId_Prod_$sandboxId"
    }
    elseif ($flightNameType -eq 'FlightId') 
    {
        $submissionIdVariableName = "WS_SubmissionId_$flightId"
    }
    else 
    {
        $flightNameNoSpace = $flightName.Replace(" ", "_")
        $submissionIdVariableName = "WS_SubmissionId_$flightNameNoSpace"
    }

    # Try to grab submission Id from release variables in case this is a retry
    $shouldPublish = $true
    $submissionId = "NoId"

    # See if submissionIdVariableName is part of the environment variable
    if (Test-Path "Env:$submissionIdVariableName")
    {
        $submissionId = (Get-ChildItem "Env:$submissionIdVariableName").value
        Write-Output "Found submission Id $submissionId from release variables"
        if ($skipPolling)
        {
            Write-Warning "Skip polling is checked, but a submission Id was found in the release variables.$([Environment]::NewLine)" + `
            "This task populates the submission Id as release variable only if the submission has been submitted and 'Preserve Submission ID' is checked.$([Environment]::NewLine)" + `
            "Assuming $submissionId was created by a previous run of this release.$([Environment]::NewLine)" + `
            "This task will terminate.$([Environment]::NewLine)" + `
            "$([Environment]::NewLine)" + `
            "If you want to retry a failed submission, either uncheck the skip polling option to monitor the existing submission,$([Environment]::NewLine)" + `
            "or remove the value on the SubmissionId release variable to create a new submission. You might need to also check the 'Delete Pending Submission' box."
            Write-Output "No action taken. See warnings for more information"
            Write-VstsSetResult -Result "Succeeded" -Message "No action taken. See warnings for more information"
            $shouldPublish = $false
        }

        try
        {
            if ($(Watch-ExistingSubmission @commonParams -SubmissionId $submissionId))
            {
                Write-Output "Existing submission $submissionId completed"
                Write-VstsSetResult -Result "Succeeded" -Message "Existing submission $submissionId completed"
                $shouldPublish = $false
            }
            else
            {
                Write-Output "Existing submission $submissionId did not complete. Retrying with new submission"
                $shouldPublish = $true
            }
        }
        catch
        {
            $exceptionString = $($_ | Out-String)
            if ($exceptionString.Contains('(404)'))
            {
                Write-Warning "Submission Id $submissionId was not found. Retrying with new submission"
                $shouldPublish = $true
            }
            else
            {
                $newException = New-Object System.Management.Automation.RuntimeException -ArgumentList "Error while trying to watch for existing submission $submissionId. See Inner exception for details", $_.Exception
                throw $newException
            }
        }
    }

    if ($shouldPublish)
    {
        $publishTaskParams = @{
            'CreateRollout' = $createRollout
            'Contents' = $contents
            'DeletePackages' = $deletePackages
            'DisableTelemetry' = $disableTelemetry
            'EndPointObj' = $endPointObj
            'Force' = $force
            'IsSeekEnabled' = $isSeekEnabled
            'IsSparseBundle' = $isSparseBundle
            'IsMandatoryUpdate' = $isMandatoryUpdate
            'InputMethod' = $inputMethod
            'JsonPath' = $jsonPath
            'JsonZipUpdateMetadata' = $jsonZipUpdateMetadata
            'LogPath' = $logPath
            'MandatoryUpdateDifferHours' = $mandatoryUpdateDifferHours
            'MetadataUpdateMethod' = $metadataUpdateMethod
            'MetadataSource' = $metadataSource
            'MinimumMetadata' = $minimumMetadata
            'NugetPath' = $NugetPath
            'NumberOfPackagesToKeep' = $numberOfPackagesToKeep
            'Rollout' = $rollout
            'ExistingPackageRolloutAction' = $existingPackageRolloutAction
            'SourceFolder' = $sourceFolder
            'StoreBrokerHelperPath' = $StoreBrokerHelperPath
            'StoreBrokerPath' = $StoreBrokerPath
            'TargetPublishMode' = $targetPublishMode
            'TargetPublishDate' = $targetPublishDate
            'UpdateImages' = $updateImages
            'UpdateVideos' = $updateVideos
            'UpdateText' = $updateText
            'UpdatePublishModeAndVisibility' = $updatePublishModeAndVisibility
            'UpdatePricingAndAvailability' = $updatePricingAndAvailability
            'UpdateAppProperties' = $updateAppProperties
            'UpdateGamingOptions' = $updateGamingOptions
            'UpdateNotesForCertification' = $updateNotesForCertification
            'Visibility' = $visibility
            'ZipPath' = $zipPath
        }
        
        Write-Output "Start publishing"
        $submissionId = Start-Publishing @commonParams @publishTaskParams
        Write-Output "Submitted submission $submissionId"

        if ($preserveSubmissionId)
        {
            if ($null -eq $Env:SYSTEM_ACCESSTOKEN)
            {
                Write-Warning $("You chose to preserve the submission ID at the release level, but the agent did not populate the auth token. Skipping operation.$([Environment]::NewLine)" + `
                "Verify you have checked the option 'Allow scripts to access the OAuth token' for this agent phase.$([Environment]::NewLine)" + `
                "For more details, see https://github.com/Microsoft/windows-dev-center-vsts-extension/blob/master/docs/usage.md#advanced-options")
            }
            else
            {
                try
                {
                    # This functionality has not been tested in TFS servers
                    $setVariableParams = @{
                        'TeamProject' = $Env:SYSTEM_TEAMPROJECT
                        'AccessToken' = $Env:SYSTEM_ACCESSTOKEN
                        'Name' = $submissionIdVariableName
                        'Value' = $submissionId
                        'Verbose' = $useVerbose
                    }

                    if (-not [string]::IsNullOrWhiteSpace($Env:RELEASE_RELEASEID))
                    {
                        $setVariableParams['TeamFoundationServerUri'] = $Env:SYSTEM_TEAMFOUNDATIONSERVERURI
                        $setVariableParams['ReleaseId'] = $Env:RELEASE_RELEASEID
                        Set-ReleaseVariable @setVariableParams
                        Write-Output "Release has been updated with release variable $submissionIdVariableName = $submissionId"
                    }
                    else
                    {
                        $setVariableParams['TeamFoundationCollectionUri'] = $Env:SYSTEM_TEAMFOUNDATIONCOLLECTIONURI
                        $setVariableParams['BuildId'] = $Env:BUILD_BUILDID
                        Set-BuildVariable @setVariableParams
                        Write-Output "Build has been updated with build variable $submissionIdVariableName = $submissionId"
                    }
                }
                catch 
                {
                    Write-Warning "There was an error preserving the submission ID. Continuing normal process"
                    Write-Verbose "Error preserving submission ID on resource. Details:"
                    Write-Verbose $($_ | Out-String)
                    Write-Verbose $($_.Exception.ToString())
                }
            }
        }
        else
        {
            Write-Output "The release won't be modified to store the submission ID."
        }

        if ($skipPolling)
        {
            Write-Output "Submission has been submitted. Skipping polling as requested."
            Write-Output "You can view the progress of the submission validation on the Dev Portal here:"
            Write-Output "https://partner.microsoft.com/en-us/dashboard/apps/$appId/submissions/$submissionId/"
            Write-VstsSetResult -Result "Succeeded" -Message "Submission has been submitted. Skipping polling as requested."
        }
        else
        {
            Write-Output "Polling for submission $submissionId to finish"

            $shouldMonitor = $true
            while ($shouldMonitor)
            {
                try
                {
                    # Refresh AccessToken before polling
                    $commonParams['AccessToken'] = (Get-AzureRMAccessToken $endPointObj $endpointId $resource).access_token
                    if (-not $(Watch-ExistingSubmission @commonParams -SubmissionId $submissionId -TargetPublishMode $targetPublishMode))
                    {
                        throw $("The submission $submissionId didn't reach the publishing state.$([Environment]::NewLine)" + `
                        "Verify issues in dev center: https://partner.microsoft.com/en-us/dashboard/products/$appId/submissions/$submissionId")
                    }
                    Write-Output "Submission $submissionId completed"
                    $shouldMonitor = $false
                }
                catch
                {
                    # Catch any authorization related exception and retry polling by refreshing the access token
                    if ($_.Exception.Message -ilike "*Unauthorized*")
                    {
                        Write-Output "Got exception with authentication while trying to check on submission. Will try again. The exception was:" -Exception $_ -Level Warning
                    }
                    else {
                        throw $_
                    }
                }
            }

            Write-VstsSetResult -Result "Succeeded" -Message "Submission $submissionId completed"
        }
    }

    # Always call vsts command to set variable so it is consumable by future tasks in the same job.
    Write-Output "##vso[task.setvariable variable=$OutSubmissionIdVariableName;isSecret=false;isOutput=true;]$submissionId"
    Write-Output "Future tasks can consume the variable $OutSubmissionIdVariableName using this task's reference name"
    Write-Output "For more information on output variables, visit https://github.com/Microsoft/azure-pipelines-agent/blob/master/docs/preview/outputvariable.md"
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