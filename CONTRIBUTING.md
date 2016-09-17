# Visual Studio Team Services extension for the Windows Store

## For general documentation about the extension, visit the [marketplace]
(https://marketplace.visualstudio.com/items?itemName=MS-RDX-MRO.windows-store-publish)

## Guidelines for opening issues

In all cases, make sure to search the list of issues before opening a new one. Duplicate issues will be closed.

### 1. Questions

You should only open an issue to report a bug or make a suggestion. If you have questions about the way the
extension work, please [send us an email](mailto:wdcrsppt@microsoft.com).

### 2. Bugs

To report a bug, please include as much information as possible, namely:

* Which version of the extension you are using
* Your agent configuration
* If possible, logs from the task that exhibit the erroneous behavior
* The behavior you expect to see

Please also mark your issue with the 'bug' label.

### 3. Suggestions

We welcome your suggestions for enhancements to the extension. To ensure that we can integrate your suggestions
effectively, try to be as detailed as possible and include:

* What you want to achieve / what is the problem that you want to address
* What is you approach for solving the problem
* If applicable, a user scenario of the feature/enhancement in action

Please also mark your issue with the 'suggestion' label.

## Guidelines for contributing code

We welcome all pull requests. To maximize your chances of being accepted, your pull request should include a clear
description of your changes, and your commits should have descriptive messages as well.

### Developer prerequisites and tools

In order to be able to build and contribute code, you will need [node.js](https://nodejs.org) and (npm)
[https://npmjs.com] (bundled with node).

This project is written in [TypeScript](https://www.typescriptlang.org/) and uses [Gulp](http://gulpjs.com/) for the
build system. They are marked as dev dependencies so you do not need to install them separately, but you should be
familiar with them.

### How to build

1. Clone this repo in ```$winstore-extension```
2. ```cd $winstore-extension```
3. ```npm install```
4. ```typings install```
4. ```gulp```

Consult [gulp.js](./gulp.js) for more build options.

### Code of conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact
[opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

### Legal

You will need to complete a Contributor License Agreement (CLA). Briefly, this agreement testifies that you are granting
us permission to use the submitted change according to the terms of the project's license, and that the work being
submitted is under appropriate copyright. You only need to do this once.

When you submit a pull request, @msftclas will automatically determine whether you need to sign a CLA, comment on the PR
and label it appropriately. If you do need to sign a CLA, please visit https://cla.microsoft.com and follow the steps.
