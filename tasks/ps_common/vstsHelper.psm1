function BasicAuthHeader()
{
    [CmdletBinding()]
    param(
        [string]$authtoken
        )

    $ba = (":{0}" -f $authtoken)
    $ba = [System.Text.Encoding]::UTF8.GetBytes($ba)
    $ba = [System.Convert]::ToBase64String($ba)
    $h = @{Authorization=("Basic{0}" -f $ba);ContentType="application/json"}
    return $h
}

function Set-ReleaseVariable
{
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string] $teamFoundationServerUri,

        [Parameter(Mandatory)]
        [string] $teamProject,

        [Parameter(Mandatory)]
        [string] $releaseId,

        [Parameter(Mandatory)]
        [string] $accessToken,

        [Parameter(Mandatory)]
        [string] $name,

        [Parameter(Mandatory)]
        [string] $value
    )

    $resourceApiUri = [IO.Path]::Combine($teamFoundationServerUri, $teamProject, "_apis", "Release", "releases", $releaseId)
    $resourceApiUri = "$($resourceApiUri)?api-version=4.1-preview.6"

    $h = BasicAuthHeader $accessToken

    $resource = Invoke-RestMethod -Uri $resourceApiUri -Headers $h -Method Get

    # If the variable does not exist, add it as empty first
    if($null -eq $resource.variables.$name)
    {
        $varObject = [PSCustomObject]@{value=""}
        $resource.variables | Add-Member -Value $varObject -Name $name -MemberType 'NoteProperty'
    }
    $resource.variables.$name.value = $value;

    # Update resource
    $updatedResource = $resource | ConvertTo-Json -Depth 10 -Compress
    $updatedResource = [Text.Encoding]::UTF8.GetBytes($updatedResource)

    Invoke-RestMethod -Uri $resourceApiUri -Method Put -Headers $h -ContentType "application/json" -Body $updatedResource | Out-Null

    Write-Verbose "Variable $name has been preserved with value $value"
}

function Set-BuildVariable
{
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string] $teamFoundationCollectionUri,

        [Parameter(Mandatory)]
        [string] $teamProject,

        [Parameter(ParameterSetName="Build", Mandatory)]
        [string] $buildId,

        [Parameter(Mandatory)]
        [string] $accessToken,

        [Parameter(Mandatory)]
        [string] $name,

        [Parameter(Mandatory)]
        [string] $value
    )

    $resourceApiUri = [IO.Path]::Combine($teamFoundationCollectionUri, $teamProject, "_apis", "build", "builds", $buildId)
    $resourceApiUri = "$($resourceApiUri)?api-version=4.1"

    $h = BasicAuthHeader $accessToken

    $resource = Invoke-RestMethod -Uri $resourceApiUri -Headers $h -Method Get
    $resourceParameters = $resource.parameters | ConvertFrom-Json

    # If the variable does not exist, add it as empty first
    if($null -eq $resourceParameters.$name)
    {
        $resourceParameters  | Add-Member -Value "" -Name $name -MemberType 'NoteProperty'
    }
    $resourceParameters.$name = $value;

    # Update resource
    $resource.parameters = $resourceParameters  | ConvertTo-Json -Depth 10 -Compress
    $updatedResource  = $resource | ConvertTo-Json -Depth 10 -Compress
    $updatedResource = [Text.Encoding]::UTF8.GetBytes($updatedResource)

    Invoke-RestMethod -Uri $resourceApiUri -Method Patch -Headers $h -ContentType "application/json" -Body $updatedResource | Out-Null

    Write-Verbose "Variable $name has been preserved with value $value"
}