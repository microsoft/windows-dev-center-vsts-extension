# Azure DevOps extension for the Windows Store API (Partner Center API)

[![Build Status](https://office.visualstudio.com/CLE/_apis/build/status%2FWindows%20Store%20Azure%20DevOps%20Extension%2Fwindows-dev-center-vsts-extension%2FWindowsDevCenterVstsExtension-Build-Prod?repoName=microsoft%2Fwindows-dev-center-vsts-extension&branchName=master)](https://office.visualstudio.com/CLE/_build/latest?definitionId=30507&repoName=microsoft%2Fwindows-dev-center-vsts-extension&branchName=master)

This extension provides tasks to automate the release of your Windows apps to the Windows Store from your continuous integration environment in Azure DevOps (formely Visual Studio Team Services or VSTS). You no longer need to manually update your apps to the [Windows Partner Center dashboard](https://partner.microsoft.com/en-us/dashboard/windows/overview).

There are 2 major versions for this extension: v3 and v0. 
* V3 is for internal users at Microsoft and it could only be used within Microsoft owned ADO organizations. It authenticates to Windows Store publishing API using certificate or [workload identity federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation). Both of these methods are available only within Microsoft. It's mandatory for internal Microsoft users to use this version due to the recent security requirement to stop using client secret for authentication in Microsoft Entra ID.
* V0 is for external users outside of Microsoft and it authenticates to Windows Store Publishing API using [client secret](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials?tabs=client-secret).

## Setup

See instructions on setting up the extension in [Setup](./docs/setup.md)

## Usage

See instructions on how to use the extension in [Usage](./docs/usage.md)

## Developing and contributing

We welcome your suggestions for enhancements to the extension. Please see the [Contribution Guide](./docs/contributing.md) for information on how to develop and contribute.

## Code of conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Legal and Licensing

Azure DevOps extension for the Windows Store is licensed under the [MIT license](./LICENSE)

## Privacy Policy

For more information, refer to Microsoft's [Privacy Policy](https://go.microsoft.com/fwlink/?LinkID=521839).

## Terms of Use

For more information, refer to Microsoft's [Terms of Use](https://www.microsoft.com/en-us/legal/intellectualproperty/copyright/default.aspx).