Import-Module "$PSScriptRoot\..\lib\ps_modules\StoreBroker\StoreBroker"
Import-Module "$PSScriptRoot\..\tasks\store-publish-V2\publish.psm1"

if (-not (Get-Module -ListAvailable -Name SomeModule)) {
    Install-Module -Name PesterMatchHashtable
}

Set-Variable -Name "TestListingsPath" -Value "$PSScriptRoot\TestingMetadata"
Set-Variable -Name "TestListingsEmptyPath" -Value "$PSScriptRoot\TestingMetadataEmpty"
Set-Variable -Name "TestListingsMissingFiles" -Value "$PSScriptRoot\TestingMetadataMissingFiles"


Describe "Update-MetadataListings" {
    It "Returns empty because the listing path cannot be found" {
        Update-MetadataListings -MetadataSource "" -UpdateImagesAndCaptions | Should BeNullOrEmpty
    }

    It "Returns an listing object, with listings for 'en-us', but there is no images" {
        $expectedOutput = @{
            "en-us" = @{
                baseListing = @{
                    RecommendedHardware = @()
                    CopyrightAndTrademarkInfo = "(c) Microsoft Corporation"
                    ReleaseNotes = "•       Feature 1: This is the description of the feature.`r`n•       Feature 2: This is the description of the feature.`r`n•       Feature 3: This is the description of the feature.`r`n•       Feature 4: This is the description of the feature.`r`n•       Feature 5: This is the description of the feature.`r`n•       Feature 6: This is the description of the feature.`r`n•       Feature 7: This is the description of the feature."
                    Description = "OHelloWorld Descriptions. This is a app used for testing the metadata updates."
                    SupportContact = ""
                    Features = @("Microsoft test only. Returns the test app version number. For testing only.")
                    Keywords = @("appfortestingonly", "fortesting")
                    LicenseTerms = ""
                    WebsiteUrl = ""
                    Title = "OHelloWorld Desktop"
                    PrivacyPolicy = ""
                }
            }
        }

        Update-MetadataListings -MetadataSource $TestListingsPath | Should MatchHashtable $expectedOutput
    }

    It "Returns an listing object, with listings for 'en-us', with image metadata" {
        $expectedOutput = @{
            "en-us" = @{
                baseListing = @{
                    RecommendedHardware = @()
                    CopyrightAndTrademarkInfo = "(c) Microsoft Corporation"
                    ReleaseNotes = "•       Feature 1: This is the description of the feature.`r`n•       Feature 2: This is the description of the feature.`r`n•       Feature 3: This is the description of the feature.`r`n•       Feature 4: This is the description of the feature.`r`n•       Feature 5: This is the description of the feature.`r`n•       Feature 6: This is the description of the feature.`r`n•       Feature 7: This is the description of the feature."
                    Description = "OHelloWorld Descriptions. This is a app used for testing the metadata updates."
                    SupportContact = ""
                    Features = @("Microsoft test only. Returns the test app version number. For testing only.")
                    Keywords = @("appfortestingonly", "fortesting")
                    LicenseTerms = ""
                    WebsiteUrl = ""
                    Title = "OHelloWorld Desktop"
                    PrivacyPolicy = ""
                    images = @(
                        @{
                            'fileStatus' = 'PendingUpload'
                            'imageType' = 'Screenshot'
                            'description.115292150481501' = 'Test only'
                            'fileName' = "$TestListingsPath\Listings\en-us\baseListing\images\Screenshot\1152921504815018704.png"
                        }, 
                        @{
                            'fileStatus' = 'PendingUpload'
                            'imageType' = 'Screenshot'
                            'fileName' = "$TestListingsPath\Listings\en-us\baseListing\images\Screenshot\1231243252353.png"
                            'description.1231243252353' = 'Another image for test only'
                        }
                    )
                } 
            }
        }

        Update-MetadataListings -MetadataSource $TestListingsPath -UpdateImagesAndCaptions | Should MatchHashtable $expectedOutput
    }

    
    It "Returns an listing object, but it's empty because there is no metadata files. There is an empty object for image since UpdateImagesAndCaptions is specified" {
        $expectedOutput = @{
            "en-us" = @{
                baseListing = @{
                    images = @{}
                }
            }
        }

        Update-MetadataListings -MetadataSource $TestListingsEmptyPath -UpdateImagesAndCaptions | Should MatchHashtable $expectedOutput
    }

    It "Returns an listing object, but it's empty because there is no metadata files. No object for image since UpdateImagesAndCaptions is not specified" {
        $expectedOutput = @{
            "en-us" = @{
                baseListing = @{
                }
            }
        }

        Update-MetadataListings -MetadataSource $TestListingsEmptyPath | Should MatchHashtable $expectedOutput
    }

    It "Returns an listing object, but there are some fields missing because their corresponding files are missing" {
        $expectedOutput = @{
            "en-us" = @{
                baseListing = @{
                    Description = "OHelloWorld Descriptions. This is a app used for testing the metadata updates."
                    Features = @("Microsoft test only. Returns the test app version number. For testing only.")
                    Keywords = @("appfortestingonly", "fortesting")
                    Title = "OHelloWorld Desktop"
                }
            }
        }

        Update-MetadataListings -MetadataSource $TestListingsMissingFiles | Should MatchHashtable $expectedOutput
    }
}

Describe "Update-MetadataTrailers" {
    It "Returns an object, with trailers for 'en-us'" {
        $expectedOutput = @(
            @{
                'trailerAssets' = @{
                    'en-us' = @{
                        'imageList' = @(
                            @{
                                'fileName' = '\Trailers\trailer1.trailerAssets\en-us\images\trailer1thumbnail.png'
                                'description' = 'Trailer 1 screenshot description en-us'
                            }
                        )
                        'title' = 'Trailer 1 Title en-us'
                    }
                }
                'videoFileName' = '\Trailers\trailer1.mp4'
            },
            @{
                'trailerAssets' = @{
                    'en-us' = @{
                        'imageList' = @(
                            @{
                                'fileName' = '\Trailers\trailer2.trailerAssets\en-us\images\trailer2thumbnail.png'
                                'description' = 'Trailer 2 screenshot description en-us'
                            }
                        )
                        'title' = 'Trailer 2 Title en-us'
                    }
                }
                'videoFileName' = '\Trailers\trailer2.mp4'
            }
        )
        Update-MetadataTrailers -MetadataSource $TestListingsPath | Should MatchHashtable $expectedOutput
    }
}