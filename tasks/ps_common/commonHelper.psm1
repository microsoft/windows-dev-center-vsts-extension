function Get-SubmissionPackages
{
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)]
        [ValidateScript({if (Test-Path -Path $_ -PathType Container) { $true } else { throw "Source Folder '$_' cannot be found." }})]
        [string] $SourceFolder,

        [Parameter(Mandatory)]
        [string] $Contents
    )

    # Normalize new line to LF
    $Contents = $Contents.Replace("`r`n","`n")
    $Contents = $Contents.Replace("`r","`n")
    $contentsList = $Contents.Split("`n")
    $applicationPackages = @()

    foreach($content in $contentsList) {
        $pkgFiles = Find-Match -DefaultRoot $SourceFolder -Pattern $content
        foreach ($pkg in $pkgFiles) {
            $pkgObj = @{
                'fileName' = $pkg.ToLower().Replace($SourceFolder.ToLower(), "")
            }
            $applicationPackages += $pkgObj
        }
    }

    return $applicationPackages
}

function Get-ProductIdAndFlightId
{
    [CmdletBinding()]
    param(
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

        [string] $FlightId,

        [string] $FlightName,

        [string] $AccessToken
    )

    if ($AppNameType -eq 'AppName')
    {
        Write-Verbose "Getting AppId for AppName: $AppName"
        $AppId = Get-AppIdFromAppName -AppName $AppName -AccessToken $AccessToken
    }

    Write-Verbose "App ID: $AppId"
    [boolean]$useVerbose = $($VerbosePreference -eq "Continue")
    $productInfo = Get-Product -AppId $AppId -AccessToken $AccessToken -Verbose:$useVerbose -NoStatus
    if ($null -eq $productInfo)
    {
        throw "Cannot find product id based on app id $AppId"
    }

    $productId = $productInfo.id

    if ($ReleaseTrack -eq "Flight")
    {
        if ($FlightNameType -eq 'FlightName')
        {
            Write-Verbose "Getting FlightId for FlightName: $FlightName"
            $FlightId = Get-FlightIdFromFlightName -ProductId $productId -FlightName $FlightName -AccessToken $AccessToken
        }

        if ([string]::IsNullOrEmpty($FlightId))
        {
            throw "Release track is set to Flight but FlightId cannot be found"
        }

        Write-Verbose "Flight ID: $FlightId"
    }
    elseif ($ReleaseTrack -eq "Production")
    {
        if ((-not [string]::IsNullOrEmpty($FlightId)) -or (-not [string]::IsNullOrEmpty($FlightName)))
        {
            throw "Release track is set to Production but FlightId and FlightName are provided. This is not alloed"
        }
    }

    return [PSCustomObject]@{ 'ProductId' = $productId;'FlightId' = $FlightId }
}

function Get-AppIdFromAppName
{
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)]
        [string] $AppName,

        [string] $AccessToken
    )
    Write-Verbose "App Name: $AppName"
    [boolean]$useVerbose = $($VerbosePreference -eq "Continue")
    $productList = Get-Product -AccessToken $AccessToken -Verbose:$useVerbose -NoStatus
    $appFound = $false
    $appId = [string]::Empty
    foreach ($productInfo in $ProductList)
    {
        if ([string]::Equals($productInfo.name, $AppName, [stringcomparison]::OrdinalIgnoreCase))
        {
            $appId = $productInfo.externalIds[0].value
            $appFound = $true
            break
        }
    }

    if (-not $appFound)
    {
        throw "Cannot find app $AppName"
    }

    return $appId
}

function Get-FlightIdFromFlightName
{
    [CmdletBinding()]
    param (
        [Parameter(Mandatory)]
        [string] $FlightName,

        [Parameter(Mandatory)]
        [string] $ProductId,

        [string] $AccessToken
    )
    [boolean]$useVerbose = $($VerbosePreference -eq "Continue")
    $flightList = Get-Flight -ProductId $ProductId -AccessToken $AccessToken -Verbose:$useVerbose -NoStatus
    $flightId = [string]::Empty
    $flightFound = $false
    foreach ($flightInfo in $flightList)
    {
        if ([string]::Equals($flightInfo.name, $FlightName, [stringcomparison]::OrdinalIgnoreCase))
        {
            $flightId = $flightInfo.id
            $flightFound = $true
            break
        }
    }

    if (-not $flightFound)
    {
        throw "Cannot find flight $FlightName"
    }

    return $flightId
}