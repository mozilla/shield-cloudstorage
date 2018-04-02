# shield-cloudstorage
Cloud storage Shield Study WebExtension Experiment

## Setup

1. Get a Firefox 59+
2. Install

  ```
  npm install -g web-ext  # just make it global!
  web-ext run --firefox=/Applications/FirefoxNightly.app/Contents/MacOS/firefox-bin
  ```

## pre-requisite
- Desktop with cloud storage provider client such as [Dropbox](https://www.dropbox.com/install)

## in Firefox:

1. `tools > Web Developer > Browser Console`
2. Open link e.g. https://www.mozilla.org/en-US/firefox/all/
3. Click on any download link. Notification shows inside Download Panel
4. If Cloud Storage API has never been initialized before first download initializes API and subsequent downloads shows notification.
5. Right click on the downloaded item, shows 'Move to <provider>' option in context menu for default downloads e.g. ~/Downloads

## Results/ Effects:

1. Click on Download link shows notification asking user to opt-in to cloud storage
2. Result expected with different options selected in notification
* Save to provider app -  Save all subsequent download to provider local download folder e.g. ~/Dropbox/Downloads
* Not Now - Closes Notification to be shown after a configurable interval

3. cloud.services.prompt.interval pref sets the interval at which user should be prompted again.

4. Downloaded item in cloud provider folder will be marked with provider icon in Download history

5. TBD: For default downloads, selecting option 'Move to <provider>' moves download in provider folder

## Helpful links
* [Bug 1441949](https://bugzilla.mozilla.org/show_bug.cgi?id=1441949)
* [Bug 1447521](https://bugzilla.mozilla.org/show_bug.cgi?id=1447521)
* [Bug 1450016](https://bugzilla.mozilla.org/show_bug.cgi?id=1450016)
