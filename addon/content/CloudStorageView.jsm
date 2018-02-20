/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var {classes: Cc, interfaces: Ci, utils: Cu} = Components;

this.EXPORTED_SYMBOLS = [ "CloudStorageView" ];

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "CloudStorage",
                                  "resource://gre/modules/CloudStorage.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Downloads",
                                  "resource://gre/modules/Downloads.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "DownloadPaths",
                                  "resource://gre/modules/DownloadPaths.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "DownloadSync",
                                  "resource://gre/modules/cloudstorage/DownloadSync.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "FileUtils",
                                  "resource://gre/modules/FileUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "NetUtil",
                                  "resource://gre/modules/NetUtil.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "OS",
                                  "resource://gre/modules/osfile.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PlacesUtils",
                                  "resource://gre/modules/PlacesUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "setTimeout",
                                  "resource://gre/modules/Timer.jsm");
/**
 * The external API exported by this module.
 */
var CloudStorageView = {
  studyUtils: null,                // Reference to shield StudyUtils.jsm
  propertiesURI: null,             // Stores URI to properties files defining UI strings
  doorHangerNotification: null,    // Cloud storage door-hanger prompt notification
  isCloseHidden: true,             // Property to store if door-hanger prompt close button is shown
  isNotificationPersistent: false, // Property to store if door-hanger prompt is of type persistent
  notificationTransientTime: null, // Transient time in ms after which prompt is removed
  defaultIconBox: null,            // Reference to container element of notification accessible using iconBox property
                                   // By default global PopupNotifications object uses the notification-popup-box element

  /**
    * Init method to initialize cloud storage view and studyUtils property
    */
  async init(studyUtils, propertiesURI, isHidden, isPersistent, transientTime) {
    try {
      if (!studyUtils) {
        Cu.reportError("CloudStorageView: Failed to initialize studyUtils");
        return;
      }
      this.studyUtils = studyUtils;
      this.propertiesURI = propertiesURI;
      this.isCloseHidden = isHidden;
      this.isNotificationPersistent = isPersistent;
      this.notificationTransientTime = transientTime;

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

      // Exit without initializing CloudViewInternal for control branch
      if (studyUtils.getVariation().name == "control") {
        return;
      }
      await CloudViewInternal.init();
    } catch (err) {
      Cu.reportError(err);
    }
  },

  /**
   * Handles 'cloudstorage-prompt-notification' by scanning client desktop
   * and displaying provider prompt for an existing cloud provider user.
   *
   * @param targetPath
   *        complete path of item to be downloaded
   * @return {Promise} that resolves successfully once door hangar prompt is shown
   */
  async handlePromptNotification(targetPath) {
    let chromeDoc = Services.wm.getMostRecentWindow("navigator:browser");
    if (!chromeDoc.PopupNotifications) {
      return;
    }

    // Check and retrieve provider prompt info from CloudStorage API.
    // Prompt existing cloud provider users to opt-in by
    // saving files directly to provider download folder
    let provider = await CloudStorage.promisePromptInfo();
    if (provider) {
      // Add-on doesn't support Google Drive custom download paths. Exit without
      // prompting if user has Google Drive Download folder set to folder
      // different from <HOME>/Google Drive
      if (provider.key === "GDrive" &&
          !await CloudViewInternal.checkIfAssetExists(provider.value.downloadPath)) {
        await this.studyUtils.telemetry({ message: "gdrive_custom_path" });
        return;
      }

      // Capture global PopupNotifications object iconBox value before
      // changing it to point to parent element of downloads-button
      this.defaultIconBox = chromeDoc.PopupNotifications.iconBox;

      CloudViewInternal.prefCloudProvider = provider;
      if (!CloudViewInternal.inProgressDownloads.has(targetPath)) {
        CloudViewInternal.inProgressDownloads.set(targetPath, {});
      }

      await this._promptForSaveToCloudStorage(chromeDoc, provider);
      CloudViewInternal.promptVisible = true;

      let panelNotification = chromeDoc.document.getElementById("notification-popup");
      await this.studyUtils.telemetry({
        message: "prompt_alignment",
        window_width: chromeDoc.innerWidth.toString(),
        window_height: chromeDoc.innerHeight.toString(),
        isPromptOut: (panelNotification &&
                      panelNotification.getAttribute("popupid") === "cloudStoragePrompt" &&
                      panelNotification.getAttribute("arrowposition") === "after_start") ? "true" : "false",
      });
    }

    // Handle hiding cloud storage prompt if downloads panel is open
    let panel = chromeDoc.document.getElementById("downloadsPanel");
    if (panel) {
      panel.addEventListener("popupshown", function() {
        if (CloudViewInternal.promptVisible) {
          CloudStorageView._removeNotification(true);
        }
      }, {once: true});
    }

    // Handle subsequent downloads started when prompt is still visible
    if (CloudViewInternal.promptVisible &&
        !CloudViewInternal.inProgressDownloads.has(targetPath)) {
      CloudViewInternal.inProgressDownloads.set(targetPath, {});
    }
  },

  /**
   * In preferences UI, under Downloads, user can opt-out of cloud storage.
   * Observe download preferences and notify telemetry if user is 'opted_in'
   * or 'opted_out' of cloud storage.
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
    let path = "chrome://cloud-shared/skin/" + name.replace(/\s+/g, "").toLowerCase() + ".svg";
    return path;
  },

  async _promptForSaveToCloudStorage(chromeDoc, provider) {
    let self = this;
    let providerName = provider.value.displayName;

    let options = {
      persistent: this.isNotificationPersistent,
      popupIconURL: this._getIconURI(providerName),
      hideClose: this.isCloseHidden,
      closeButtonFunc: () => {
        self._removeNotification(true);
      },
      eventCallback: eventName => {
        switch (eventName) {
          case "dismissed":
            if (!self.doorHangerNotification.options.persistent) {
              self._removeNotification(true);
            }
            break;
          case "showing":
            // Hide cloud storage prompt if its arrow is not pointing to downloads button
            if (self.doorHangerNotification &&
                self.doorHangerNotification.owner.iconBox === this.defaultIconBox) {
              setTimeout(function dismissal() {
                CloudStorageView._removeNotification(true);
              }, 0);
            }
            break;
        }
      },
    };

    let key = provider.key;
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
    this._showNotification(chromeDoc, actions, options, providerName);
  },

  _showNotification(chromeDoc, actions, options, name) {
    let downloadBundle = Services.strings.createBundle(this.propertiesURI);
    let msgString = CloudViewInternal.inProgressDownloads.size > 1 ?
      "cloud.service.multi.save.description" : "cloud.service.save.description";

    let message = downloadBundle.formatStringFromName(msgString, [name], 1);
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

    // Update the global PopupNotifications object iconBox to parent of
    // downloads button in nav bar
    chromeDoc.PopupNotifications.iconBox =
      chromeDoc.document.getElementById("nav-bar-customization-target");

    let notificationid = "cloudStoragePrompt";
    this.doorHangerNotification = chromeDoc.PopupNotifications.show(
      chromeDoc.gBrowser.selectedBrowser,
      notificationid, message, "downloads-button",
      main_action, secondary_action, options);

    // Reset iconBox property back to default value stored in defaultIconBox
    chromeDoc.PopupNotifications.iconBox = this.defaultIconBox;

    // If notification has transientTime defined
    // Wait until after the delay to dismiss the prompt
    let self = this;
    if (self.notificationTransientTime) {
      setTimeout(function dismissal() {
        CloudStorageView._removeNotification(true);
      }, self.notificationTransientTime);
    }
  },

  _removeNotification(isLastPromptUpdate = false) {
    CloudStorageView.doorHangerNotification.remove();
    CloudViewInternal.reset();
    // CloudStorage API savePromptResponse call with provider key value
    // as null and remember value as 'false', returns after setting
    // pref cloud.services.lastprompt
    isLastPromptUpdate ? CloudStorage.savePromptResponse(null, false) : null;
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
   * Internal property that stores downloads started, once
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
    let view = {
      onDownloadChanged: async download => {
        if (this.promptVisible && this.inProgressDownloads.has(download.target.path)) {
          this.inProgressDownloads.set(download.target.path, download);
          // No action, as prompt is visible and we are still waiting for user response
        } else if (!this.promptVisible &&
                   this.inProgressDownloads.has(download.target.path) &&
                   download.succeeded && await this.checkIfAssetExists(download.target.path)) {
          // Move downloaded item if prompt is not visible and download is a valid inProgreeDownloads item
          // that has succeded and file at target path still exists.
          // We explicitly check again if target path exists to handle scenarios when download completes
          // while prompt is visible and gets moved to provider folder while handling 'Save to <provider>' action
          // of door hangar prompt.
          await this.handleMove();
        }
      },
    };

    let list = await Downloads.getList(Downloads.ALL);
    await list.addView(view);
  },

  /**
   * Checks if the asset with input path exist on
   * file system
   * @return {Promise}
   * @resolves
   * boolean value of file existence check
   */
  checkIfAssetExists(path) {
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

  async _moveDownload(download, dwnldTargetPath, providerDwnldFldrPath, key) {
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

    // Write download to config json
    DownloadSync.writeConfigDownload(movedDownload, key);
  },

  async handleMove() {
    if (!this.prefCloudProvider) {
      return;
    }

    // Compute provider download folder path from prefCloudProvider object
    let providerDownloadFolder = OS.Path.join(this.prefCloudProvider.value.downloadPath,
      this.prefCloudProvider.value.typeSpecificData["default"]);

    let providerKey = this.prefCloudProvider.key;

    // create download directory if it doesn't exist
    try {
      await OS.File.makeDir(providerDownloadFolder, {ignoreExisting: true});
    } catch (err) {
      Cu.reportError(err);
      return;
    }

    this.inProgressDownloads.forEach(async (value, key) => {
      if (value.succeeded) {
        await this._moveDownload(value, key, providerDownloadFolder, providerKey);
        this.inProgressDownloads.delete(key);
      }
    });

    // Reset prompt visible flag
    this.promptVisible = false;
  },
};
