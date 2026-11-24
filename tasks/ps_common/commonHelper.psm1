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

        Write-Verbose "Flight ID: $FlightId"
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

function Register-BundledAssemblyResolver([string] $libraryDir)
{
    # Windows PowerShell 5.1 has no binding redirects, and MSAL's dependencies reference
    # different versions of System.Memory and Unsafe. Load the copy shipped with the task instead.
    # The handler is C# because .NET can call it on threads where PowerShell script cannot run.
    if (-not ('BundledAssemblyResolver' -as [type]))
    {
        Add-Type -TypeDefinition @"
using System; using System.IO; using System.Reflection;
public static class BundledAssemblyResolver {
    static string _dir;
    public static void Register(string dir) {
        if (_dir != null) return;
        _dir = dir;
        AppDomain.CurrentDomain.AssemblyResolve += (s, e) => {
            string path = Path.Combine(_dir, new AssemblyName(e.Name).Name + ".dll");
            return File.Exists(path) ? Assembly.LoadFrom(path) : null;
        };
    }
}
"@
    }
    [BundledAssemblyResolver]::Register($libraryDir)
}