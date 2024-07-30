function Update-ProductRollout
{
    [CmdletBinding()]
    param(
        [string] $AppNameType,

        [string] $AppId,

        [string] $AppName,

        [Parameter(Mandatory)]
        [ValidateSet('Production', 'Flight')]
        [string] $ReleaseTrack,

        [ValidateSet('FlightName', 'FlightId', '')]
        [string] $FlightNameType,

        [string] $FlightId,

        [string] $FlightName,

        [Parameter(Mandatory)]
        [ValidateSet('set', 'halt', 'finalize')]
        [string] $RolloutAction,

        [Parameter(Mandatory)]
        [ValidateRange(0.0, 100.0)]
        [float] $RolloutValue,

        [Parameter(Mandatory)]
        [ValidateRange(0.0, 100.0)]
        [float] $RolloutActionThreshold,

        [Parameter(Mandatory)]
        [string] $CurrentPackageVersionRegex,

        [switch] $FailIfNoRollout,

        [switch] $SkipIfNoMatch
    )

    [boolean]$useVerbose = $($VerbosePreference -eq "Continue")
    $infoParams = @{
        'AppId'          = $AppId
        'AppName'        = $AppName
        'AppNameType'    = $AppNameType
        'FlightId'       = $FlightId
        'FlightName'     = $FlightName
        'FlightNameType' = $FlightNameType
        'ReleaseTrack'   = $ReleaseTrack
        'Verbose'        = $useVerbose
    }
    $returnValues = Get-ProductIdAndFlightId @infoParams
    $productId = $returnValues.ProductId
    $FlightId = $returnValues.FlightId

    $params = @{
        "ProductId" = $productId
        "Verbose"   = $useVerbose
        "NoStatus"  = $true
    }

    if (-not [string]::IsNullOrWhiteSpace($FlightId))
    {
        $params['FlightId'] = $FlightId
    }

    $existingSubmission = Get-Submission @params
    if ($null -eq $existingSubmission)
    {
        throw "Get-Submission returned 0 submission. To modify a rollout, a submission must first exist."
    }

    $version = "0.0"
    if ($existingSubmission.GetType().Name -eq 'Object[]')
    {
        $result = if ($FailIfNoRollout) {"Failed"} else {"Succeeded"}
        foreach ($submission in $existingSubmission)
        {
            if ($submission.state -ne 'Published')
            {
                $SubmissionId = $submission.id
                break
            }
        }

        $message = "Setting task status as $result since Get-Submission returns multiple submissions, and there is an unpublished submission $SubmissionId, and fail if no rollout option is set to $FailIfNoRollout"
        if ($FailIfNoRollout) 
        {
            throw $message
        }
        return [PSCustomObject]@{ Message = $message; RolloutValue = $RolloutValue; Version = $version; ShouldPublishValues = $false }
    }

    $SubmissionId = $existingSubmission.id

    if (-not ($existingSubmission.resourceType -eq 'Submission' -and $existingSubmission.state -eq 'Published'))
    {
        $result = if ($FailIfNoRollout) {"Failed"} else {"Succeeded"}
        $message = "Setting task status as $result since the only existing submission $SubmissionId is unpublished and fail if no rollout option is set to $FailIfNoRollout"

        if ($FailIfNoRollout) 
        {
            throw $message
        }
        return [PSCustomObject]@{ Message = $message; RolloutValue = $RolloutValue; Version = $version; ShouldPublishValues = $false } 
    }

    $existingRollout = Get-SubmissionRollout -ProductId $productId -SubmissionId $SubmissionId -Verbose:$useVerbose -NoStatus

    if (($null -eq $existingRollout) -or (-not $existingRollout.isEnabled) -or ($existingRollout.state -ne "Initialized"))
    {
        $result = if ($FailIfNoRollout) {"Failed"} else {"Succeeded"}
        $message = "Setting task status as $result since no rollout is found and fail if no rollout option is set to $FailIfNoRollout"
        if ($FailIfNoRollout)
        {
            throw $message
        }
        return [PSCustomObject]@{ Message = $message; RolloutValue = $RolloutValue; Version = $version; ShouldPublishValues = $false }
    }
    
    Write-Verbose "Existing rollout detected. Validating current version against packages in rollout..."
    $productPackages = Get-ProductPackage -ProductId $productId -SubmissionId $SubmissionId -Verbose:$useVerbose
    if ($productPackages.Count -eq 0)
    {
        throw "Get-ProductPackage returned 0 package"
    }
    # Based on the regex provided by the user, we validate all packages are from the same Build output
    $isCurrentVersionInRollout = $true
    foreach ($pkg in $productPackages)
    {
        if ($pkg.version -notmatch $CurrentPackageVersionRegex)
        {
            $isCurrentVersionInRollout = $false
            $version = $pkg.version
            break
        }
    }

    if (-not $isCurrentVersionInRollout)
    {
        $result = if (-not $SkipIfNoMatch) {"Failed"} else {"Succeeded"}
        $message = "Setting task status as $result since at least one package does not match the regex $CurrentPackageVersionRegex and skip if no match option is set to $SkipIfNoMatch"
        if (-not $SkipIfNoMatch)
        {
            throw $message
        }
        return [PSCustomObject]@{ Message = $message; RolloutValue = $RolloutValue; Version = $version; ShouldPublishValues = $false }
    }

    $version = $productPackages[0].version
    Write-Verbose "Choosing $version to advertise to following tasks"

    # Transform input if needed.
    if ($RolloutAction -eq "set")
    {
        if ($RolloutValue -eq 100.0) 
        {
            Write-Warning "Setting the rollout value to 100.0% is equal to finalizing the rollout. Changing RolloutAction to 'Finalize'"
            $RolloutAction = 'finalize'
        }
        elseif ($RolloutValue -eq 0.0)
        {
            Write-Warning "Setting the rollout value to 0.0% is equal to halting the rollout. Changing RolloutAction to 'Halt'"
            $RolloutAction = 'halt'
        }
    }

    if ($RolloutAction -eq "set")
    {
        Update-SubmissionRollout -ProductId $productId -SubmissionId $SubmissionId -Percentage $RolloutValue -Verbose:$useVerbose -NoStatus
    }
    else 
    {
        $status = [string]::Empty

        if ($existingRollout.percentage -lt $RolloutActionThreshold)
        {
            $status = $RolloutAction
        }
        else 
        {
            $status = if ($RolloutAction -eq "finalize") {"halt"} else {"finalize"}
            Write-Warning "Switching rollout action to $status as existing rollout percentage $($existingRollout.percentage) >= threshold $RolloutActionThreshold"
        }

        $rolloutActionToStatusMapping = @{
            'finalize' = 'Completed'
            'halt'     = 'RolledBack'
        }
        $trainId = if ($ReleaseTrack -eq 'Flight') {$FlightId} else {"Prod"}
        Write-Verbose "Completing rollout by changing rollout status to $($rolloutActionToStatusMapping[$status]) for $trainId of Product $productId"
        Update-SubmissionRollout -ProductId $productId -SubmissionId $SubmissionId -State $rolloutActionToStatusMapping[$status] -Verbose:$useVerbose -NoStatus

        $RolloutValue = $(if ($status -eq "finalize") {100.0} else {0.0})
    }

    return [PSCustomObject]@{ Message = "Rollout succeeded"; RolloutValue = $RolloutValue; Version = $version; ShouldPublishValues = $true }
}