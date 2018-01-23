# shield-cloudstorage
Add-on for cloud storage Fx56 shield experiment

## install

`npm install`
`npm run build`

## pre-requisite
- Desktop with cloud storage provider client such as [Dropbox](https://www.dropbox.com/install)

## in Firefox:

1. `about:debugging > [load temporary addon] > choose `dist/shield-cloudstorage.xpi`
2. `tools > Web Developer > Browser Console`
3. Open link e.g. https://www.mozilla.org/en-US/firefox/all/
4. Click on any download link. If you see the prompt 'You have chosen to open' asking to choose between open and save file - select save file.
5. If Cloud Storage API has never been initialized before first download initializes API and subsequent downloads shows door hangar prompt.

## Results/ Effects:

1. Click on Download link shows door hangar prompt asking user to opt-in to cloud storage
2. Result expected with different options selected in door hangar prompt
* Save to provider download folder -  Save downloaded file to provider local download folder e.g. ~/Dropbox/Downloads
* Cancel - Save file to user default download folder e.g. ~/Downloads or user selected custom folder
* Save with always remember checked - Sets provider download folder as default download by updating pref browser.download.folderlist as 3 and any subsequent download will be saved to provider download folder. In about:preferences, under 'Downloads' user is shown an option 'Save to Provider Name'
* Cancel with always remember checked - Set provider as rejected in cloud.services.rejected.key  pref and user will never be prompted again to use the provider. If a user has multiple provider on desktop , other providers will be used in door hangar prompt.

3. cloud.services.prompt.interval pref is set using value promptInterval in addon/Config.jsm, pref sets the interval at which user should be prompted again.

4. Downloaded item will be marked with provider icon in Download history

## Helpful links
* [Bug 1399231](https://bugzilla.mozilla.org/show_bug.cgi?id=1399231)
* [Bug 1399198](https://bugzilla.mozilla.org/show_bug.cgi?id=1399198)
* [Bug 1357160](https://bugzilla.mozilla.org/show_bug.cgi?id=1357160)
