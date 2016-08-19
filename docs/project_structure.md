# Project structure

This document should help you to understand how the extension is structured.
However, don't rely on it too much, as things can change quickly. Remember that
the code is the source of truth!

## Build system

This project uses [gulp](http://gulpjs.com). The [gulpfile](../gulpfile.js)
can provide some hints about how the build works, but here are some basic
details:

* ```package``` (also the default task), will build everything and create
the extension VSIX package. If you want to run some tests on your own account,
you can set the --publisher switch to whatever you need.
* ```compile``` will simply take the tasks and common code, compile them and
put them in their appropriate directories. This is useful if you want to do some
"offline" tests, i.e. call your code directly without using the extension.
* ```dependencies``` installs the node packages required by the tasks. This is
ran by ```package```, but if you want to just ```compile``` you should do it
separately. You should run it when you want to test code that relies on a
package that you just added.
* ```clean``` is the standard clean task. You should ideally run this before
publishing a new version of the extension. The ```tfx``` client will take
_everything_ in the build folder to make the .vsix file, so you want to avoid
having garbage in there.

## Adding a task

1. Create a directory in the tasks sub-folder.
2. Add in it a task.json file. Create a new GUID to use as an ID for the task,
and add that to task.json. In the ```execution.Node``` fi eld, make sure that the
```target``` points to your task's main file **with a .js extension** and that
it is under a **local/** directory. Note that the file *itself* should be
directly under the task directory; the build system will move it to a 'local'
subdirectory (consult the gulpfile for why this happens).
3. Add the task to the [extension manifest](../vss-extension.json). Make sure
that its name is the same as the folder name.

If you're confused, try copying an existing task.

## Structuring a task

This is a guideline, and not required, but I found that separating code in at
least two files helps with testing. One file is responsible for grabbing values
from the task UI and validating them, and another is responsible for actually
carrying out the task. That way it's possible to run the second file under
node locally without having to publish the extension, which saves a lot of time.

## Adding new dependencies

**Always ```--save``` any dependencies and typings you install. Otherwise others
won't get them when they pull your code.**

If you find a new package that you'd like to use as part of a task, you need to
add it to the "master" [package.json](../package.json) file in the root of the
project. When packaging, the build system will install the dependencies in the
proper task folders.

Note that if you're going to do a ```gulp compile``` after adding a dependency,
you should run ```gulp dependencies``` as well (either after, before, or at 
the same time).

When you add a new dependency, you should check if there are typings available
for it. There are two scenarios:

1. The typings are part of the package (e.g. ```vsts-task-lib```). In this case
you must also declare the package as a dev dependency, then install it.
Afterwards, you can refer to the typings using a triple-slash reference to
```../../node_modules/<your_module>/index.d.ts``` (or whatever typings file you
need).
2. The typings are not part of the package (e.g. ```q```). Try
```typings search <your_module>``` to see if any typings are available, and
install them if so.

## Extending the build system

If you'd like to add a gulp plugin to do something new with the build, make sure
you install it as a dev dependency, and not a regular dependency.
