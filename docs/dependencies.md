# Dependencies

## v0.\*

Tasks with version v0.\* of the extension are written in TypeScript and their dependencies are listed in [package.json](../package.json).
Running ```npm install``` will install them.

## v2.\*

Tasks with version v2.\* of the extension are written in PowerShell and are powered by [StoreBroker](https://github.com/Microsoft/StoreBroker/tree/v2).
Running ```gulp``` will create the necessary folder structure and populate the dependencies as part of the build. For ways of manually getting
the dependencies, visit the links below.

For StoreBroker, create a directory named ```StoreBroker``` under ```lib``` and follow the instructions in the link.

- [NugetPackages](../lib/ps_modules/NugetPackages/README.MD)
- [StoreBroker](https://github.com/Microsoft/StoreBroker/blob/v2/Documentation/SETUP.md#installation)
- [VstsTaskSdk](https://github.com/Microsoft/azure-pipelines-task-lib/blob/master/powershell/Docs/Consuming.md#where-to-get-it)

