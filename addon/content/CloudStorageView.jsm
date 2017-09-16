/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;

this.EXPORTED_SYMBOLS = [ "CloudStorageView" ];

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "CloudStorage",
                                  "resource://gre/modules/CloudStorage.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Downloads",
                                  "resource://gre/modules/Downloads.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "DownloadPaths",
                                  "resource://gre/modules/DownloadPaths.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "FileUtils",
                                  "resource://gre/modules/FileUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "NetUtil",
                                  "resource://gre/modules/NetUtil.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "OS",
                                  "resource://gre/modules/osfile.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PlacesUtils",
                                  "resource://gre/modules/PlacesUtils.jsm");
/**
 * The external API exported by this module.
 */
var CloudStorageView = {
  studyUtils: null,
  propertiesURL: null,
  /**
    * Init method to initialize cloud storage view and studyUtils property
    */
  async init(studyUtils, propertiesURL) {
    try {
      if (!studyUtils) {
        Cu.reportError("CloudStorageView: Failed to initialize studyUtils");
        return;
      }
      this.studyUtils = studyUtils;
      this.propertiesURL = propertiesURL;
      await CloudViewInternal.init();

      // Get number of providers on user desktop and send data to telemetry.
      // Invoke getDownloadFolder on CloudStorage API to ensure API is initialized
      // This is workaround to force initialize API for first time enter to
      // ensure getStorageProviders call returns successfully.
      await CloudStorage.getDownloadFolder();
      let providers = await CloudStorage.getStorageProviders();
      let keys = [];
      if (providers.size > 0) {
        providers.forEach((value, key) => {
          keys.push(key);
        });
      }
      await this.studyUtils.telemetry({
        message: "addon_init",
        provider_count: providers.size.toString(),
        provider_keys: keys.join(","),
      });
    } catch (err) {
      Cu.reportError(err);
    }
  },

  /**
   * Handles 'cloudstorage-prompt-notification' by scanning client desktop
   * and displaying provider prompt for a existing cloud provider user.
   *
   * @param targetPath
   *        complete path of item to be downloaded
   * @return {Promise} that resolves successfully once door hangar prompt is shown
   */
  async handlePromptNotification(targetPath) {
    // Check and retrive provider prompt info from CloudStorage API.
    // Prompt existing providre users to opt-in
    // to save files directly to provider download folder

    let provider = await CloudStorage.promisePromptInfo();
    if (provider) {
      CloudViewInternal.promptVisible = true;
      CloudViewInternal.prefCloudProvider = provider;
      if (!CloudViewInternal.inProgressDownloads.has(targetPath)) {
        CloudViewInternal.inProgressDownloads.set(targetPath, {});
      }

      let wm = Cc["@mozilla.org/appshell/window-mediator;1"].
        getService(Ci.nsIWindowMediator);
      await this._promptForSaveToCloudStorage(wm.getMostRecentWindow("navigator:browser"), provider);
    }

    // Handle subsequent downloads started when prompt is still visible
    if (CloudViewInternal.promptVisible &&
        !CloudViewInternal.inProgressDownloads.has(targetPath)) {
      CloudViewInternal.inProgressDownloads.set(targetPath, {});
    }
  },

  async _promptForSaveToCloudStorage(chromeDoc, provider) {
    let key = provider.key;
    let providerName = provider.value.displayName;
    let options = {
      persistent: true,
      popupIconURL: this._getIconURI(providerName),
    };

    let self = this;
    let actions = {
      main: async function cs_main(aState) {
        let remember = aState && aState.checkboxChecked;
        // Pass selected value as true indicating user has selected to save
        // downloaded file with cloud provider
        CloudStorage.savePromptResponse(key,
                                        remember,
                                        true);
        // Move downloads inside inprogressdownloads to provider folder
        await CloudViewInternal.handleMove();

        // If opted-in, set observers to send subsequent download pref changes to telemetry
        if (remember) {
          Services.prefs.addObserver("browser.download.folderList", self.downloadPrefObserve);
          Services.prefs.addObserver("browser.download.useDownloadDir", self.downloadPrefObserve);
        }

        let telemetryData = {
          message: remember ? "prompt_opted_in" : "prompt_save_click",
          provider: key,
          timestamp: Math.floor(Date.now() / 1000).toString(),
        };
        await self.studyUtils.telemetry(telemetryData);
      },
      secondary: async function cs_secondary(aState) {
        let remember = aState && aState.checkboxChecked;
        CloudStorage.savePromptResponse(key, remember);
        CloudViewInternal.reset();
        let telemetryData = {
          message: remember ? "prompt_rejected" : "prompt_cancel_click",
          provider: key,
          timestamp: Math.floor(Date.now() / 1000).toString(),
        };
        await self.studyUtils.telemetry(telemetryData);
      },
    };
    this._showCloudStoragePrompt(chromeDoc, actions, options, providerName);
  },

  /**
   * In preferences UI, under Downloads, user can opt-out of cloud storage.
   * Observes download preferences and notify telemetry if user is opted_in
   * or opted_out of cloud storage.
   */
  async downloadPrefObserve(subject, topic, data) {
    let folderListPref = Services.prefs.getIntPref("browser.download.folderList", 1);
    let useDownloadDirPref = Services.prefs.getBoolPref("browser.download.useDownloadDir", true);
    await CloudStorageView.studyUtils.telemetry({
      message: "download_prefs",
      cloud_storage_state: (folderListPref === 3 && useDownloadDirPref) ? "opted_in" : "opted_out",
      timestamp: Math.floor(Date.now() / 1000).toString(),
    });
  },

  // URI to access icon files
  _getIconURI(name) {
    let path = "chrome://cloud/skin/" + name.toLowerCase() + "_18x18.png";
    return path;
  },

  _showCloudStoragePrompt(chromeDoc, actions, options, name) {
    let downloadBundle = Services.strings.createBundle(this.propertiesURL);
    let message = downloadBundle.formatStringFromName("cloud.service.save.description",
                                                     [name], 1);
    let main_action = {
      label: downloadBundle.formatStringFromName("cloud.service.saveCloud.label",
                                                     [name], 1),
      accessKey: downloadBundle.GetStringFromName("cloud.service.saveCloud.accesskey"),
      callback: actions.main,
    };

    let secondary_action = [{
      label: downloadBundle.GetStringFromName("cloud.service.saveLocal.label"),
      accessKey: downloadBundle.GetStringFromName("cloud.service.saveLocal.accesskey"),
      callback: actions.secondary,
    }];

    options.checkbox = {
      show: true,
      label: downloadBundle.GetStringFromName("cloud.service.save.remember"),
    };

    let notificationid = "cloudServicesInstall";
    chromeDoc.PopupNotifications.show(chromeDoc.gBrowser.selectedBrowser,
                                        notificationid, message, null,
                                        main_action, secondary_action, options);
  },
};

// Cloud View Internal API that observe downloads and handle
// downloaded item move once user opt-in to save download to provider folder
var CloudViewInternal = {
  /**
   * Provider used in prompts shown to user
   */
  prefCloudProvider: null,

  /**
   * Internal property that stores downloads started once
   * provider prompt is shown and is waiting for user action.
   * Downloads are stored in key value pair with 'key' as download target path
   * and 'value' as 'Download' object respresenting a single download
   */
  inProgressDownloads: new Map(),

  /**
   * Stores prompt visibility state
   */
  promptVisible: false,

  /**
   * Initialises a view that will be notified of changes to downloads
   *
   */
  async init() {
    let list = await Downloads.getList(Downloads.ALL);
    let view = {
      onDownloadChanged: async download => {
        if (this.promptVisible && this.inProgressDownloads.has(download.target.path)) {
          this.inProgressDownloads.set(download.target.path, download);
          // No action, as prompt is visible and we are still waiting for user response
        } else if (!this.promptVisible &&
                   this.inProgressDownloads.has(download.target.path) &&
                   download.succeeded && this._checkIfAssetExists(download.target.path)) {
          // Move downloaded item if prompt is not visible and download is a valid inProgreeDownloads item
          // that has succeded and file at target path still exists.
          // We explicitly check again if target path exists to handle scenarios when download completes
          // while prompt is visible and gets moved to provider folder while handling 'Save to <provider>' action
          // of door hangar prompt.
          await this.handleMove();
        }
      },
    };
    await list.addView(view);
  },

  /**
   * Checks if the asset with input path exist on
   * file system
   * @return {Promise}
   * @resolves
   * boolean value of file existence check
   */
  _checkIfAssetExists(path) {
    return OS.File.exists(path).catch(err => {
      Cu.reportError(`Couldn't check existance of ${path}`, err);
      return false;
    });
  },

  reset() {
    this.promptVisible = false;
    this.inProgressDownloads.clear();
  },

  /**
   * Moves downloaded item to provider download folder and adds
   * moved file in provider folder as a download item in DownloadList
   * object shown in user interface in Download Panel and Download History
   *
   * @param download
   *        object representing a single download
   * @param dwnldTargetPath
   *        String with complete original target path of download
   * @param providerDwnldFldrPath
   *        String with complete path of provider download folder
   * @return {Promise} that resolves successfully once download is moved
   *         to provider folder and movedDownload is added as download item
   *         in DownloadList object
   */

  async _moveDownload(download, dwnldTargetPath, providerDwnldFldrPath) {
    let destPath = providerDwnldFldrPath ?
      OS.Path.join(providerDwnldFldrPath, OS.Path.basename(dwnldTargetPath)) : "";

    // Ensure destPath is a unique file
    destPath = DownloadPaths.createNiceUniqueFile(new FileUtils.File(destPath)).path;

    try {
      await OS.File.move(dwnldTargetPath, destPath);
    } catch (err) {
      Cu.reportError(err);
      return;
    }

    // Create a duplicate download which will show the correct
    // target path for moved session download in Download UI panel
    let publicList = await Downloads.getList(Downloads.ALL);

    let movedDownload = await Downloads.createDownload({
      source: download.source,
      target: destPath
    });
    movedDownload.startTime = download.startTime;
    movedDownload.succeeded = true;
    await publicList.add(movedDownload);

    // Update destination path used in download history library panel
    PlacesUtils.annotations.setPageAnnotation(
      NetUtil.newURI(download.source.url),
      "downloads/destinationFileURI",
      "file://" + destPath, 0,
      PlacesUtils.annotations.EXPIRE_WITH_HISTORY);

    // Explicitly updates the state of a moved download
    movedDownload.refresh().catch(Cu.reportError);

    // Remove original download in favor of moved download from download UI panel
    await publicList.remove(download);
  },

  async handleMove() {
    if (!this.prefCloudProvider) {
      return;
    }

    // Compute provider download folder path from prefCloudProvider object
    let providerDownloadFolder = OS.Path.join(this.prefCloudProvider.value.downloadPath,
      this.prefCloudProvider.value.typeSpecificData["default"]);

    // create download directory if it doesn't exist
    try {
      await OS.File.makeDir(providerDownloadFolder, {ignoreExisting: true});
    } catch (err) {
      Cu.reportError(err);
      return;
    }

    this.inProgressDownloads.forEach(async (value, key) => {
      if (value.succeeded) {
        await this._moveDownload(value, key, providerDownloadFolder);
        this.inProgressDownloads.delete(key);
      }
    });

    // Reset prompt visible flag
    this.promptVisible = false;
  },
};
