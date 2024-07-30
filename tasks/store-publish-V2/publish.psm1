function Start-Publishing
{
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)] 
        [ValidateSet('AppName', 'AppId')]
        [string] $AppNameType,

        [string] $AppId,

        [string] $AppName,

        [Parameter(Mandatory)]
        [ValidateSet('Production', 'Flight', 'Sandbox')]
        [string] $ReleaseTrack,

        [ValidateSet('FlightName', 'FlightId', '')]
        [string] $FlightNameType,

        [string] $FlightName,

        [string] $FlightId,

        [string] $SandboxId,

        [PSCustomObject] $EndpointObject,

        [Parameter(Mandatory)]
        [string] $InputMethod,

        [string] $JsonPath,

        [string] $ZipPath,

        [string] $SourceFolder,

        [string] $Contents,

        [uint32] $NumberOfPackagesToKeep,

        [int] $MandatoryUpdateDifferHours,

        [string] $MetadataUpdateMethod,

        [string] $MetadataSource,

        [ValidateRange(0.0, 100.0)]
        [float] $Rollout,

        [string] $ExistingPackageRolloutAction,

        [string] $StoreBrokerHelperPath,

        [string] $StoreBrokerPath,

        [string] $NugetPath,

        [string] $LogPath,

        [ValidateSet('Default', 'Manual', 'Immediate', 'SpecificDate')]
        [string] $TargetPublishMode,
        
        [string] $TargetPublishDate,

        [string] $Visibility,

        [switch] $IsSparseBundle,

        [switch] $JsonZipUpdateMetadata,

        [switch] $IsMandatoryUpdate,

        [switch] $CreateRollout,

        [switch] $IsSeekEnabled,

        [switch] $Force,

        [switch] $DisableTelemetry,

        [switch] $DeletePackages,

        [switch] $UpdateImages,

        [switch] $UpdateVideos,

        [switch] $UpdateText,

        [switch] $UpdatePublishModeAndVisibility,

        [switch] $UpdatePricingAndAvailability,

        [switch] $UpdateAppProperties,

        [switch] $UpdateGamingOptions,

        [switch] $UpdateNotesForCertification,

        [switch] $MinimumMetadata
    )

    [boolean]$useVerbose = $($VerbosePreference -eq "Continue")
    $infoParams = @{
        'AppId' = $AppId
        'AppName' = $AppName
        'AppNameType' = $AppNameType
        'FlightId' = $FlightId
        'FlightName' = $FlightName
        'FlightNameType' = $FlightNameType
        'ReleaseTrack' = $ReleaseTrack
        'Verbose' = $useVerbose
    }
    $returnValues = Get-ProductIdAndFlightId @infoParams
    $productId = $returnValues.ProductId
    $FlightId = $returnValues.FlightId

    $submissionParameters = @{
        'Force' = $Force
        'Verbose' = $useVerbose
        'NoStatus' = $true
    }

    if ($ReleaseTrack -eq 'Flight')
    {
        # Flight Id should have already been figured out at this point
        $submissionParameters['FlightId'] = $FlightId
        Write-Verbose "Metadata for this submission will not be updated because releasetrack is flight"
    }
    elseif ($ReleaseTrack -eq 'Sandbox')
    {
        $submissionParameters['SandboxId'] = $SandboxId
        Write-Verbose "Metadata for this submission will not be updated because releasetrack is sandbox"
    }

    if ($DeletePackages)
    {
        Write-Verbose "numberOfPackagesToKeep: $NumberOfPackagesToKeep"
        if ($NumberOfPackagesToKeep -eq 0)
        {
            $submissionParameters['ReplacePackages'] = $true
        }
        else 
        {
            $submissionParameters['UpdatePackages'] = $true
            $submissionParameters['RedundantPackagesToKeep'] = $NumberOfPackagesToKeep
        }
    }
    else 
    {
        $submissionParameters['AddPackages'] = $true
    }

    Write-Verbose "isMandatoryUpdate: $IsMandatoryUpdate"
    if ($IsMandatoryUpdate)
    {
        Write-Verbose "mandatoryUpdateDifferHours: $MandatoryUpdateDifferHours"
        $submissionParameters['IsMandatoryUpdate'] = $true
        $submissionParameters['MandatoryUpdateEffectiveDate'] = $(Get-Date).AddHours($MandatoryUpdateDifferHours)
    }

    if ($IsSparseBundle) 
    {
        <#
            For Sparse bundles, the submission workflow is as follows:
            1. Create a new submission for each DLC app
            2. Upload corresponding packages to each DLC app
            3. Wait for the package on each DLC app to finish processing
            4. Create a new submission for the Main app
            5. Upload packages for the Main app
            6. Check for validations on the Main app submission. This will also get validations from the DLC apps
            7. Submit the Main app submission. This will also submit all the DLC apps
        #>
        Write-Verbose "We are submitting Sparse Bundle applications into the store. Preparing submissions for DLC apps"
        $submissionParameters['PackageRootPath'] = $SourceFolder
        # Sparse bundles have no update on metadata by default
        $submissionParameters['MediaRootPath'] = $SourceFolder

        # We are normalizing the end lines to LF
        $Contents = $Contents.Replace("`r`n","`n")
        $Contents = $Contents.Replace("`r","`n")
        $allApps = $Contents.Split("`n")
        $mainAppContentsMinimatch = [string]::Empty

        $DLCJobParameters = $submissionParameters.Clone()
        $DLCJobParameters['StoreBrokerHelperPath'] = $StoreBrokerHelperPath
        $DLCJobParameters['StoreBrokerPath'] = $StoreBrokerPath
        $DLCJobParameters['NugetPath'] = $NugetPath
        $DLCJobParameters['EndpointObject'] = $EndpointObject
        $DLCJobParameters['DisableTelemetry'] = $DisableTelemetry

        Write-Verbose "Starting Sparse Bundle submissions"
        $logPaths = @()

        for($i = 0; $i -lt $allApps.Length; $i++)
        {
            $app = $allApps[$i]
            # The expected format for each line in the content is something like "AppId:Package's Relative Path in Minimatch"
            # E.g. 9P3VFTW97HHB:mypackage*(rs3|rs4)_x+(86|64).appxbundle
            $appIdMinimatchPackages = $app.Split(':')
            if ($appIdMinimatchPackages[0] -ne $appId)
            {
                $dlcJsonObject = @{
                    'ProductId' = (Get-Product -AppId $appIdMinimatchPackages[0] -Verbose:$useVerbose -NoStatus).id
                    'applicationPackages' = (Get-SubmissionPackages -SourceFolder $SourceFolder -Contents $appIdMinimatchPackages[1])
                    'listings' = @{}
                }
                $DLCJobParameters['JsonObject'] = [PSCustomObject]$dlcJsonObject
                $logName = $LogPath + ".$($dlcJsonObject.ProductId).txt"
                $logPaths += $logName
                $DLCJobParameters['LogPath'] = $logName
                Publish-DLCApp @DLCJobParameters
            }
            else 
            {
                $mainAppContentsMinimatch = $appIdMinimatchPackages[1]
            }
        }

        $submissionJson = @{
            'ProductId' = $productId
            'applicationPackages' = (Get-SubmissionPackages -SourceFolder $SourceFolder -Contents $mainAppContentsMinimatch)
            'listings' = @{}
        }

        $submissionParameters['JsonObject'] = [PSCustomObject]$submissionJson
    }
    else
    {
        if ($InputMethod -eq 'JsonAndZip')
        {
            $submissionParameters['JsonPath'] = $JsonPath
            $submissionParameters['ZipPath'] = $ZipPath
            $submissionParameters['UpdateNotesForCertification'] = $UpdateNotesForCertification
            Write-Verbose "JSON Path: $JsonPath"
            Write-Verbose "Zip Path: $ZipPath"
            Write-Verbose "UpdateNotesForCertification: $UpdateNotesForCertification"

            if ($ReleaseTrack -eq 'Production')
            {
                $submissionParameters['UpdateAppProperties'] = $UpdateAppProperties
                $submissionParameters['UpdateGamingOptions'] = $UpdateGamingOptions
                $submissionParameters['UpdatePricingAndAvailability'] = $UpdatePricingAndAvailability
                $submissionParameters['UpdatePublishModeAndVisibility'] = $UpdatePublishModeAndVisibility
                Write-Verbose "UpdateAppProperties: $UpdateAppProperties"
                Write-Verbose "UpdateGamingOptions: $UpdateGamingOptions"
                Write-Verbose "UpdatePricingAndAvailability: $UpdatePricingAndAvailability"
                Write-Verbose "UpdatePublishModeAndVisibility: $UpdatePublishModeAndVisibility"
                
                if ($JsonZipUpdateMetadata)
                {
                    $submissionParameters['UpdateListingText'] = $UpdateText
                    $submissionParameters['UpdateImagesAndCaptions'] = $UpdateImages
                    $submissionParameters['UpdateVideos'] = $UpdateVideos
                    $submissionParameters['IsMinimalObject'] = $MinimumMetadata
                    Write-Verbose "UpdateListingText: $UpdateText"
                    Write-Verbose "UpdateImagesAndCaptions: $UpdateImages"
                    Write-Verbose "UpdateVideos: $UpdateVideos"
                    Write-Verbose "IsMinimalObject: $MinimumMetadata"
                }
            }
        }
        else
        {
            Write-Verbose "Source Folder of packages: $SourceFolder"
            $submissionJson = @{
                'ProductId' = $productId
                'ApplicationPackages' = (Get-SubmissionPackages -SourceFolder $SourceFolder -Contents $Contents)
            }

            Write-Verbose "Metadata update type: $MetadataUpdateMethod"
            if ($ReleaseTrack -eq 'Flight' -or $MetadataUpdateMethod -eq 'NoUpdate')
            {
                $submissionJson.listings = @{}
                $submissionParameters['JsonObject'] = [PSCustomObject]$submissionJson
                $submissionParameters['PackageRootPath'] = $SourceFolder
                $submissionParameters['MediaRootPath'] = $SourceFolder
            }
            else
            {
                $submissionParameters['UpdateListingText'] = $UpdateText
                $submissionParameters['UpdateImagesAndCaptions'] = $UpdateImages
                $submissionParameters['UpdateVideos'] = $UpdateVideos
                $submissionParameters['IsMinimalObject'] = $MinimumMetadata
                $submissionJson.listings = Update-MetadataListings -MetadataSource $MetadataSource -UpdateImagesAndCaptions:$UpdateImages
                if ($UpdateVideos)
                {
                    $submissionJson.trailers = Update-MetadataTrailers -MetadataSource $MetadataSource
                }
                $submissionParameters['JsonObject'] = $submissionJson
                $submissionParameters['PackageRootPath'] = $SourceFolder
                $submissionParameters['MediaRootPath'] = $MetadataSource
            }
        }
    }

    if ($CreateRollout)
    {
        Write-Verbose "Rollout: $Rollout"
        Write-Verbose "ExistingPackageRolloutAction: $ExistingPackageRolloutAction"
        Write-Verbose "isSeekEnabled: $IsSeekEnabled"
        $submissionParameters['PackageRolloutPercentage'] = $Rollout
        $submissionParameters['ExistingPackageRolloutAction'] = $ExistingPackageRolloutAction
        $submissionParameters['SeekEnabled'] = $IsSeekEnabled
    }

    if ($TargetPublishMode -ne 'Default')
    {
        $submissionParameters['TargetPublishMode'] = $TargetPublishMode
        if ($TargetPublishMode -eq 'SpecificDate')
        {
            $submissionParameters['TargetPublishDate'] = $TargetPublishDate
        }
    }

    if ((-not [String]::IsNullOrWhiteSpace($Visibility)) -and ($Visibility -ne 'Default'))
    {
        $submissionParameters['Visibility'] = $Visibility
    }

    $submissionParameters['ProductId'] = $productId
    $submissionParameters['AutoCommit'] = $true
    return Update-Submission @submissionParameters
}

function Publish-DLCApp
{
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)]
        [PSCustomObject] $JsonObject,

        [string] $FlightId,

        [string] $SandboxId,

        [int] $RedundantPackagesToKeep,

        [DateTime] $MandatoryUpdateEffectiveDate,

        [string] $PackageRootPath,

        [string] $MediaRootPath,

        [Parameter(Mandatory)]
        [string] $StoreBrokerHelperPath,

        [Parameter(Mandatory)]
        [string] $StoreBrokerPath,

        [Parameter(Mandatory)]
        [string] $LogPath,

        [Parameter(Mandatory)]
        [string] $NugetPath,

        [Parameter(Mandatory)]
        [PSCustomObject] $EndpointObject,

        [ValidateSet('Default', 'Manual', 'Immediate', 'SpecificDate')]
        [string] $TargetPublishMode,

        [string] $TargetPublishDate,

        [string] $Visibility,

        [switch] $Force,

        [switch] $MandatoryUpdate,

        [switch] $AddPackages,

        [switch] $ReplacePackages,

        [switch] $UpdatePackages,

        [switch] $DisableTelemetry,

        [switch] $NoStatus
    )

    $productId = $JsonObject.ProductId
    [boolean]$useVerbose = $($VerbosePreference -eq "Continue")
    Write-Verbose "Verbose preference has been set based on the calling script Verbose preference option"

    $dlcsSubmissionParameters = @{
        'ProductId' = $productId
        'Force' = $Force
        'FlightId' = $FlightId
        'SandboxId' = $SandboxId
        'PackageRootPath' = $PackageRootPath
        'JsonObject' = $JsonObject
        'MediaRootPath' = $MediaRootPath
        'AutoCommit' = $false
        'NoStatus' = $NoStatus
        'Verbose' = $useVerbose
    }

    if ($MandatoryUpdate)
    {
        $dlcsSubmissionParameters['IsMandatoryUpdate'] = $true
        $dlcsSubmissionParameters['MandatoryUpdateEffectiveDate'] = $MandatoryUpdateEffectiveDate
    }

    if ($AddPackages)
    {
        $dlcsSubmissionParameters['AddPackages'] = $true
    }
    elseif ($ReplacePackages)
    {
        $dlcsSubmissionParameters['ReplacePackages'] = $true
    }
    else 
    {
        $dlcsSubmissionParameters['UpdatePackages'] = $true
        $dlcsSubmissionParameters['RedundantPackagesToKeep'] = $RedundantPackagesToKeep
    }

    Write-Verbose "Creating submission for DLC $($productId)"
    $SubmissionId = Update-Submission @dlcsSubmissionParameters
    $null = Wait-ProductPackageProcessed -ProductId $productId -SubmissionId $SubmissionId -NoStatus:$NoStatus -Verbose:$useVerbose
    Write-Verbose "Finished creating submission for DLC $($productId)"
}

function Watch-ExistingSubmission 
{
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)] 
        [ValidateSet('AppName', 'AppId')]
        [string] $AppNameType,

        [string] $AppId,

        [string] $AppName,

        [Parameter(Mandatory)]
        [ValidateSet('Production', 'Flight', 'Sandbox')]
        [string] $ReleaseTrack,

        [ValidateSet('FlightName', 'FlightId', '')]
        [string] $FlightNameType,

        [string] $FlightName,

        [string] $FlightId,

        [string] $SandboxId,

        [Parameter(Mandatory)]
        [string] $SubmissionId,

        [ValidateSet('Default', 'Manual', 'Immediate', 'SpecificDate')]
        [string] $TargetPublishMode
    )
    [boolean]$useVerbose = $($VerbosePreference -eq "Continue")
    $infoParams = @{
        'AppId' = $AppId
        'AppName' = $AppName
        'AppNameType' = $AppNameType
        'FlightId' = $FlightId
        'FlightName' = $FlightName
        'FlightNameType' = $FlightNameType
        'ReleaseTrack' = $ReleaseTrack
        'Verbose' = $useVerbose
    }
    $returnValues = Get-ProductIdAndFlightId @infoParams
    $productId = $returnValues.ProductId
    $FlightId = $returnValues.FlightId

    $submissionParams = @{
        'ProductId' = $productId
        'SubmissionId' = $SubmissionId
        'Verbose' = $useVerbose
        'NoStatus' = $true
    }

    $existingSubmission = Get-Submission @submissionParams
    if ($existingSubmission.state -eq [StoreBrokerSubmissionState]::Published)
    {
        return $true
    }

    if ($existingSubmission.substate -ge [StoreBrokerSubmissionSubState]::Submitted)
    {
        Start-SubmissionMonitor -Product $productId -SubmissionId $submissionID -Verbose:$useVerbose -NoStatus
        Write-Verbose "Finished monitoring. Verifying final state."
        $submission = Get-Submission @submissionParams
        if (($null -ne $submission) -and (($TargetPublishMode -eq "Manual") -or ($TargetPublishMode -eq "SpecificDate")) -and ($submission.substate -eq [StoreBrokerSubmissionSubState]::ReadyToPublish))
        {
            return $true
        }

        if (($null -ne $submission) -and ($submission.State -eq [StoreBrokerSubmissionState]::Published))
        {
            return $true
        }
    }

    return $false
}

function Update-MetadataListings
{
    [CmdletBinding()]
    param (
        [string] $MetadataSource,

        [switch] $UpdateImagesAndCaptions
    )

    Write-Verbose "Metadata Folder path: $MetadataSource"
    Write-Verbose "Update images and captions: $UpdateImagesAndCaptions"
    $listingsMap = @{}
    $listingSource = [IO.Path]::Combine($MetadataSource, "Listings")

    Write-Verbose "Getting listings from $listingSource"
    if (-not $(Test-Path -Path $listingSource -PathType Container))
    {
        Write-Warning "Listings will be empty. Could not find Listings path $listingSource"
        return $listingsMap
    }

    $listings = Get-ChildItem $listingSource -Directory

    foreach($listing in $listings)
    {
        $locale = $listing.Name
        Write-Verbose "Obtaining metadata for language $locale"
        $listingAbsPath = $listing.FullName
        $listingAttributes = Update-ListingAttributes -ListingAbsPath $listingAbsPath

        if ($UpdateImagesAndCaptions)
        {
            Write-Verbose "Obtaining images for language $locale"
            Update-ImageListings -ListingAbsPath $listingAbsPath -ListingAttributes $listingAttributes -MetadataSource $MetadataSource
        }
        $listingAttributes.baseListing = [PSCustomObject] $listingAttributes.baseListing
        $listingsMap[$listing.Name] = $listingAttributes
    }

    return $listingsMap
}

function Update-ListingAttributes
{
    [CmdletBinding()]
    param (
        [string] $ListingAbsPath
    )

    $ret = @{}
    $baseListingPath = [IO.Path]::Combine($ListingAbsPath, "baseListing")
    if (Test-Path -Path $baseListingPath -PathType Container)
    {
        Write-Verbose "Obtaining base listing from $baseListingPath"
        $ret['baseListing'] = Get-ListingAttributes -ListingSource $baseListingPath
    }

    $overridesPath = [IO.Path]::Combine($ListingAbsPath, "platformOverrides")
    if (Test-Path -Path $overridesPath -PathType Container)
    {
        $platformOverrides = @{}
        $allOverrideDirs = Get-ChildItem $overridesPath -Directory

        foreach ($overrideDir in $allOverrideDirs)
        {
            $overridePath = $overrideDir.FullName
            Write-Verbose "Obtaining platform override $overridePath"
            $platformOverrides[$overrideDir.Name] = Get-ListingAttributes -ListingSource $overridePath
        }

        if ($platformOverrides.Count -ne 0)
        {
            $ret['platformOverrides'] = $platformOverrides
        }
    }

    return $ret
}

function Update-ImageListings
{
    [CmdletBinding()]
    param (
        [string] $ListingAbsPath,

        [Parameter(Mandatory)]
        [hashtable] $ListingAttributes,

        [string] $MetadataSource
    )

    if (-not $ListingAttributes.ContainsKey('baseListing'))
    {
        $ListingAttributes['baseListing'] = @{}
    }

    $base = $ListingAttributes['baseListing']
    if (-not $base.ContainsKey('images'))
    {
        $base['images'] = @()
    }

    Write-Verbose "Updating images from $ListingAbsPath"
    $imageAbsPath = [IO.Path]::Combine($ListingAbsPath, 'baseListing', 'images')
    $base['images'] += Update-ImageMetadata -ImageAbsPath $imageAbsPath -MetadataSource $MetadataSource
    if (-not $ListingAttributes.ContainsKey('platformOverrides'))
    {
        return
    }

    foreach ($platOverride in $ListingAttributes['platformOverrides'].Keys)
    {
        $platPath = [IO.Path]::Combine($ListingAbsPath, 'PlatformOverrides', $platOverride, "images")
        $platOverrideRef = $ListingAttributes.platformOverrides[$platOverride]
        if (-not $platOverrideRef.ContainsKey('images'))
        {
            $platOverrideRef['images'] = @()
        }

        Write-Verbose "Updating platform override images from $platPath"
        $platOverrideRef.images += Update-ImageMetadata -ImageAbsPath $platPath -MetadataSource $MetadataSource
    }
}

function Update-MetadataTrailers
{
    [CmdletBinding()]
    param (
        [string] $MetadataSource
    )
    # Return a list of trailers
    $trailersList = @()
    $trailerSource = [IO.Path]::Combine($MetadataSource, "Trailers")

    Write-Verbose "Getting trailers from $trailerSource"
    if (-not $(Test-Path -Path $trailerSource -PathType Container))
    {
        Write-Warning "Trailers will be empty. Could not find Trailers path $trailerSource"
        return $trailersList
    }

    $trailers = Get-ChildItem $trailerSource -Filter "*.mp4" -File
    foreach ($trailer in $trailers)
    {
        $trailerName = [IO.Path]::GetFileNameWithoutExtension($trailer.Name)
        $trailerPath = $trailer.FullName
        $trailerMap = @{
            'videoFileName' = $trailerPath.Replace($MetadataSource,'')
            'trailerAssets' = Get-TrailerAssets -TrailerName $trailerName -MetadataSource $MetadataSource
        }

        $trailersList += $trailerMap
    }

    return $trailersList
}

$listings_array_attributes = @{
    'keywords' = $true
    'features' = $true
    'recommendedhardware' = $true
}

function Get-ListingAttributes
{
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)]
        [ValidateScript({if (Test-Path -Path $_ -PathType Container) { $true } else { throw "ListingSource Folder '$_' cannot be found." }})]
        [string] $ListingSource
    )

    $listing = @{}
    $propFiles = Get-ChildItem $ListingSource -Filter "*.txt" -File

    foreach($propPath in $propFiles)
    {
        $propName = $propPath.Name.Substring(0, $propPath.Name.LastIndexOf('.'))
        $fileContent = [IO.File]::ReadAllText($propPath.FullName)
        if ($null -ne $fileContent)
        {
            if($script:listings_array_attributes.ContainsKey($propName.ToLowerInvariant()))
            {
                # Normalize new line to LF
                $fileContent = $fileContent.Replace("`r`n","`n")
                $fileContent = $fileContent.Replace("`r","`n")
                $fileContent = $fileContent.Split("`n")
            }
            $listing[$propName] = $fileContent
        }
        else
        {
            $listing[$propName] = [string]::Empty
        }
    }

    return $listing
}

function Update-ImageMetadata
{
    [CmdletBinding()]
    param (
        [string] $ImageAbsPath,

        [string] $MetadataSource
    )

    $imageArray = @()
    if (Test-Path -Path $ImageAbsPath -PathType Container)
    {
        $imageTypeDirs = Get-ChildItem $ImageAbsPath -Directory
        foreach ($imageTypeDir in $imageTypeDirs)
        {
            $imageTypeAbs = $imageTypeDir.FullName
            $imageFiles = Get-ChildItem $imageTypeAbs -Filter "*.png" -File

            foreach($img in $imageFiles)
            {
                $imageName = $img.BaseName
                $imageData = Get-ImageAttributes -ImageAbsPath $imageTypeAbs -ImageName $imageName -ImageType $imageTypeDir.Name -MetadataSource $MetadataSource
                $imageArray += $imageData
            }
        }
    }

    return $imageArray
}

function Get-ImageAttributes
{
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)]
        [ValidateScript({if (Test-Path -Path $_ -PathType Container) { $true } else { throw "Image Folder '$_' cannot be found." }})]
        [string] $ImageAbsPath,

        [string] $ImageName,

        [string] $ImageType,

        [string] $MetadataSource
    )

    $image = @{}
    $txtFiles = Get-ChildItem $ImageAbsPath -Filter "*$ImageName.txt" -File
    $imageAbsName = [IO.Path]::Combine($ImageAbsPath, "$ImageName.png")

    foreach($txtFile in $txtFiles)
    {
        $txtPath = $txtFile.FullName
        Write-Verbose "Loading individual attribute for $imageAbsName from $txtPath"
        $txtContent = [IO.File]::ReadAllText($txtPath)
        $txtPropertyName = $txtFile.BaseName
        $image[$txtPropertyName] = if ($null -eq $txtContent) { [string]::Empty } else { $txtContent }
    }

    $image['imageType'] = $ImageType
    $image['fileStatus'] = [StoreBrokerFileState]::PendingUpload.ToString()
    $image['fileName'] = $imageAbsName.Replace($MetadataSource,'')

    return $image
}

function Get-TrailerAssets 
{
    [CmdletBinding()]
    param (
        [string] $TrailerName,

        [string] $MetadataSource
    )

    $trailerAssetsMap = @{}
    $trailerAssetsPath = [IO.Path]::Combine($MetadataSource, 'Trailers', "$TrailerName.trailerAssets")
    Write-Verbose "Reading Locales for trailer from $trailerAssetsPath"
    $locales = Get-ChildItem $trailerAssetsPath -Directory
    foreach ($locale in $locales)
    {
        $trailerTitlePath = [IO.Path]::Combine($locale.FullName, "Title.txt")
        $thumbnailPath = [IO.Path]::Combine($locale.FullName, "images")
        $thumbNailImage = Get-ChildItem $thumbnailPath -Filter "*.png" -File
        $thumbNailTxt = Get-ChildItem $thumbnailPath -Filter "*.txt" -File
        if ($thumbNailImage.Count -eq 0)
        {
            throw "Thumbnail image file is missing"
        }

        if ($thumbNailTxt.Count -eq 0)
        {
            throw "Thumbnail description file is missing"
        }

        $thumbNailMap = @{
            "fileName" = $thumbNailImage[0].FullName.Replace($MetadataSource, '')
            "description" = [IO.File]::ReadAllText($thumbNailTxt[0].FullName)
        }

        # Even though there is only one thumbnail expected, StoreBroker requires a list due to backward compatibility
        $trailerAssetsMap[$locale.Name] = @{
            "title" = [IO.File]::ReadAllText($trailerTitlePath)
            "imageList" = @($thumbNailMap)
        }
    }

    return $trailerAssetsMap
}