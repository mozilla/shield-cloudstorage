/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

ChromeUtils.import("resource://gre/modules/Services.jsm");
ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
ChromeUtils.defineModuleGetter(this, "CloudStorage",
  "resource://gre/modules/CloudStorage.jsm");
ChromeUtils.defineModuleGetter(this, "Downloads",
  "resource://gre/modules/Downloads.jsm");
ChromeUtils.defineModuleGetter(this, "DownloadPaths",
  "resource://gre/modules/DownloadPaths.jsm");
ChromeUtils.defineModuleGetter(this, "FileUtils",
  "resource://gre/modules/FileUtils.jsm");
ChromeUtils.defineModuleGetter(this, "NetUtil",
  "resource://gre/modules/NetUtil.jsm");
ChromeUtils.defineModuleGetter(this, "OS",
  "resource://gre/modules/osfile.jsm");
ChromeUtils.defineModuleGetter(this, "PlacesUtils",
  "resource://gre/modules/PlacesUtils.jsm");
ChromeUtils.defineModuleGetter(this, "RecentWindow",
  "resource:///modules/RecentWindow.jsm");
ChromeUtils.defineModuleGetter(this, "BrowserWindowTracker",
  "resource:///modules/BrowserWindowTracker.jsm");

Cu.importGlobalProperties(["URL"]);


const EXPORTED_SYMBOLS = ["CloudDownloadsView"];
const CLOUD_SERVICES_PREF = "cloud.services.";
const CLOUD_PROVIDER_DEFAULT_ICON = "default";

var CloudDownloadsView = {
  eventEmitter: null,
  studyVariation: null,
  stylesURL: null,      // Property storing URL to clouddownloads css
  providers: null,      // Property of type Map object storing providers data
  isInitialized: false, // Property to track API has added required observers

  getRecentWindow() {
    try {
      return RecentWindow.getMostRecentBrowserWindow();
    } catch (err) {
      return BrowserWindowTracker.getTopWindow();
    }
  },

  _formatProviderName(name) {
    return name.toLowerCase().replace(" ", "");
  },

  async _filterProvidersMap(providers) {
    // Extension doesn't support Google Drive custom download paths. Delete
    // provider if user has Google Drive Download folder set to folder
    // different from <HOME>/Google Drive
    const GDRIVE_KEY = "GDrive";
    const provider = providers.get(GDRIVE_KEY);
    if (provider) {
      const isExist = await CloudDownloadsInternal.checkIfAssetExists(provider.downloadPath);
      if (!isExist) {
        // Log telemetry about GDrive Custom path
        this.eventEmitter.emit("record-telemetry", { message: "gdrive_custom_path" });
        providers.delete(GDRIVE_KEY);
      }
    }
    return providers;
  },

  /**
   * Registers Move Download option by a) creating a template moveDownload
   * menuItem and moveDownloadSubMenu (if multiple providers) inside DownloadsContextMenu
   * b) an event listener to listen to contextmenu event on downloadsListBox
   * MenuItems are updated with label attributes before displaying Move Download option inside
   * _displayMoveToCloudContextMenuItem
   */
  async registerContextMenu(browserWindow) {
    try {
      if (!browserWindow || !browserWindow.document) {
        return;
      }

      // Continue only if cloud providers exists on user device
      if (this.providers.size === 0) {
        return;
      }

      const aPopupMenu = browserWindow.document.getElementById("downloadsContextMenu");
      if (!aPopupMenu) {
        return;
      }

      // Get menuItem 'Copy Location', to insert skeleton 'Move download' menuitem and a menu separator after it
      const menuItem = aPopupMenu.getElementsByAttribute("command", "downloadsCmd_copyLocation")[0];
      if (!menuItem) {
        return;
      }

      const fragment = browserWindow.document.createDocumentFragment();
      const separator = browserWindow.document.createElement("menuseparator");
      separator.id = "moveDownloadSeparator";
      fragment.appendChild(separator);

      if (this.providers.size > 1) {
        const moveDownloadMenu = browserWindow.document.createElement("menu");
        moveDownloadMenu.id = "moveDownload";
        moveDownloadMenu.setAttribute("label", "Move Download To\u2026");
        moveDownloadMenu.setAttribute("hidden", "true");
        const moveDownloadMenuPopup = browserWindow.document.createElement("menupopup");
        moveDownloadMenuPopup.id = "moveDownloadSubMenu";
        moveDownloadMenuPopup.setAttribute("hidden", "true");

        this.providers.forEach((value, key) => {
          const moveDownloadItem = browserWindow.document.createElement("menuitem");
          moveDownloadMenuPopup.appendChild(moveDownloadItem);
        });

        // Create N+1st menuitem for 'Move to Local Downloads'
        const localDownloadItem = browserWindow.document.createElement("menuitem");
        moveDownloadMenuPopup.appendChild(localDownloadItem);

        moveDownloadMenu.appendChild(moveDownloadMenuPopup);
        fragment.appendChild(moveDownloadMenu);
      } else {
        // Add skeleton Move to menu item in context menu
        const moveDownloadItem = browserWindow.document.createElement("menuitem");
        moveDownloadItem.id = "moveDownload";
        moveDownloadItem.setAttribute("hidden", "true");
        fragment.appendChild(moveDownloadItem);
      }
      aPopupMenu.insertBefore(fragment, menuItem.nextSibling);
      aPopupMenu.addEventListener("command", this);
      aPopupMenu.addEventListener("popupshowing", this);
      browserWindow.document.getElementById("PanelUI-downloads").addEventListener("popupshowing", this);

      // Find local preferred download directory path
      // to display correct icon in Local Download context menu option
      await CloudDownloadsInternal._setDefaultDownloadDirIconURL();
    } catch (err) {
      Cu.reportError(err);
    }
  },

  unRegisterContextMenu(browserWindow) {
    const moveDownloadMenuItem = browserWindow.document.getElementById("moveDownload");
    if (!moveDownloadMenuItem) {
      return;
    }

    const aPopupMenu = browserWindow.document.getElementById("downloadsContextMenu");
    aPopupMenu.removeEventListener("command", this);
    aPopupMenu.removeEventListener("popupshowing", this);
    aPopupMenu.removeChild(moveDownloadMenuItem);
    browserWindow.document.getElementById("PanelUI-downloads").removeEventListener("popupshowing", this);

    const moveDownloadSeparator = browserWindow.document.getElementById("moveDownloadSeparator");
    aPopupMenu.removeChild(moveDownloadSeparator);
  },

  /**
   * Add observer to listen to downloads triggered to display cloud storage notification UI
   */

  registerNotification() {
    Services.obs.addObserver(this.observe, "cloudstorage-prompt-notification");
    this.isInitialized = true;
  },

  unRegisterNotification() {
    Services.obs.removeObserver(this.observe, "cloudstorage-prompt-notification");
    this.isInitialized = false;

    const browserWindow = this.getRecentWindow();
    const panelCloudNotification = browserWindow.document.getElementById("panelCloudNotification");
    if (!panelCloudNotification) {
      return;
    }
    panelCloudNotification.removeEventListener("command", this);
    browserWindow.document.getElementById("cloudDownloadPreference").removeEventListener("click", this);

    const panelDownload = browserWindow.document.getElementById("downloadsPanel-mainView");
    panelDownload.removeChild(panelCloudNotification);
  },

  /**
   * Set up browser window UI by loading cloud storage styles
   * and registering template move download context menu
   */

  async initWindowListener() {
    // Get the list of browser windows already open
    const windows = Services.wm.getEnumerator("navigator:browser");
    while (windows.hasMoreElements()) {
      // Exit setting up windows if we don't have a valid styles URL yet
      if (!this.stylesURL) {
        break;
      }
      const domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
      WindowListener.setupBrowserUI(domWindow);
      const moveDownloadMenuItem = domWindow.document.getElementById("moveDownload");
      if (moveDownloadMenuItem) {
        break;
      }
      await this.registerContextMenu(domWindow);
    }

    // Wait for any new browser windows to open
    Services.wm.addListener(WindowListener);
  },

  uninitWindowListener() {
    // Get the list of browser windows already open
    const windows = Services.wm.getEnumerator("navigator:browser");
    while (windows.hasMoreElements()) {
      const domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
      if (this.stylesURL) {
        WindowListener.tearDownBrowserUI(domWindow);
      }
      this.unRegisterContextMenu(domWindow);
    }

    const placesWindow = Services.wm.getMostRecentWindow("Places:Organizer");
    if (this.stylesURL && placesWindow) {
      WindowListener.tearDownBrowserUI(placesWindow);
    }

    // Stop listening for any new browser windows to open
    Services.wm.removeListener(WindowListener);
  },

  // Log provider count and provider keys existing on user desktop
  async handleAddOnInitTelemetry() {
    // There is no other API that awaits the result of CloudStorageInternal.init()
    // Invoke getDownloadFolder on CloudStorage API to ensure API is initialized
    // before asking CloudStorage API for storage providers info
    await CloudStorage.getDownloadFolder();
    const providers = await CloudStorage.getStorageProviders();
    const keys = Array.from(providers.keys());

    this.eventEmitter.emit("record-telemetry", {
      message: "addon_init",
      provider_count: providers.size.toString(),
      provider_keys: keys.join(","),
    });

    this.providers = await this._filterProvidersMap(providers);
  },

  async toggleAPIEnabledState() {
    try {
      if (!this.gIsAPIEnabled) {
        if (this.isInitialized) {
          if (this.studyVariation !== "control") {
            this.uninitWindowListener();
          }
          this.unRegisterNotification();
        }
        return;
      }

      await this.handleAddOnInitTelemetry();
      if (this.studyVariation !== "control") {
        await this.initWindowListener();
      }
      this.registerNotification();
    } catch (err) {
      Cu.reportError(err);
    }
  },

  async observe(subject, topic, data) {
    switch (topic) {
    case "cloudstorage-prompt-notification":
      CloudDownloadsView.eventEmitter.emit("record-telemetry", { message: "download_started" });
      if (CloudDownloadsView.studyVariation !== "control") {
        await CloudDownloadsView.showNotification();
      }
      break;
    }
  },

  buildNotificationHTML(document) {
    const fragment = document.createDocumentFragment();
    const panelCloudNotification = document.createElement("vbox");
    panelCloudNotification.id = "panelCloudNotification";
    fragment.appendChild(panelCloudNotification);

    const providerContainer = document.createElement("hbox");
    panelCloudNotification.appendChild(providerContainer);

    const icon = document.createElement("image");
    icon.id = "cloudDownloadTypeIcon";
    providerContainer.appendChild(icon);

    const cloudDownloadContainer = document.createElement("vbox");
    cloudDownloadContainer.id = "cloudDownloadContainer";

    const desc = document.createElement("description");
    desc.id = "cloudDownloadTitle";
    cloudDownloadContainer.appendChild(desc);

    const hbox = document.createElement("hbox");
    cloudDownloadContainer.appendChild(hbox);
    const innerDesc = document.createElement("description");
    innerDesc.id = "cloudDownloadDetail";
    const prefLink = document.createElement("label");
    prefLink.className = "text-link";
    prefLink.id = "cloudDownloadPreference";
    hbox.appendChild(innerDesc);
    hbox.appendChild(prefLink);

    const radiogroup = document.createElement("radiogroup");
    radiogroup.id = "multiProviderSelect";
    radiogroup.selectedIndex = -1;
    radiogroup.value = "";
    cloudDownloadContainer.appendChild(radiogroup);

    providerContainer.appendChild(cloudDownloadContainer);

    const buttonContainer = document.createElement("hbox");
    panelCloudNotification.appendChild(buttonContainer);
    for (const id of ["cloudDownloadCancel", "cloudDownloadSave"]) {
      const button = document.createElement("button");
      button.id = id;
      button.className = "panelCloudNotificationUI-button";
      buttonContainer.appendChild(button);
    }
    buttonContainer.lastChild.setAttribute("default", "true");
    return fragment;
  },

  /**
   * Display Cloud Storage Notification inside download panel that asks user to
   * save all subsequent downloads to their preferred cloud storage provider by changing
   * download settings
   */

  async showNotification() {
    const browserWindow = this.getRecentWindow();

    if (!browserWindow || !browserWindow.document) {
      return;
    }

    const document = browserWindow.document;
    const panelDownload = document.getElementById("downloadsPanel-mainView");
    if (!panelDownload) {
      return;
    }

    const providersMap = this.providers;

    // Continue only if cloud providers exists on user device
    if (providersMap.size === 0) {
      return;
    }

    // Check if user had already opted-in or
    // enough time has passed since last prompts shown
    if (!await CloudStorage.promisePromptInfo()) {
      return;
    }

    if (CloudDownloadsInternal.checkIfExistingCloudProviderDownloadSettings()) {
      this.eventEmitter.emit("record-telemetry", {
        message: "existing_cloud_provider_download_settings"
      });
      return;
    }

    let panelCloudNotification = document.getElementById("panelCloudNotification");
    if (panelCloudNotification) {
      if (panelCloudNotification.getAttribute("hidden")) {
        panelCloudNotification.removeAttribute("hidden");
      }
      return;
    }

    let providerDisplayName = null;
    let providerIcon = null;
    let providerKey = null;
    const fragment = this.buildNotificationHTML(document);
    panelDownload.prepend(fragment);

    if (providersMap.size > 1 ) {
      this._addNotificationMultipleProviders(providersMap, document);
      providerDisplayName = "Cloud Storage";
      providerIcon = CLOUD_PROVIDER_DEFAULT_ICON;
    } else {
      const provider = providersMap.entries().next().value;
      providerDisplayName = provider[1].displayName;
      providerKey = provider[0];
      providerIcon = this._formatProviderName(providerDisplayName);
    }

    document.getElementById("cloudDownloadTitle").setAttribute("value", "Save downloads to " + providerDisplayName + "?");
    document.getElementById("cloudDownloadTypeIcon").setAttribute("data-provider-icon", providerIcon);
    document.getElementById("cloudDownloadDetail").setAttribute("value", "Change your download settings any time in");
    document.getElementById("cloudDownloadPreference").setAttribute("value", "Preferences.");

    const cloudDownloadSave = document.getElementById("cloudDownloadSave");
    cloudDownloadSave.setAttribute("label", "Save to " + providerDisplayName);
    cloudDownloadSave.setAttribute("providerKey", providerKey);

    if (providerIcon === CLOUD_PROVIDER_DEFAULT_ICON) {
      cloudDownloadSave.setAttribute("disabled", true);
    } else {
      cloudDownloadSave.removeAttribute("disabled");
    }

    document.getElementById("cloudDownloadCancel").setAttribute("label", "Not Now");
    panelCloudNotification = document.getElementById("panelCloudNotification");
    panelCloudNotification.removeAttribute("hidden");
    panelCloudNotification.addEventListener("command", this);
    document.getElementById("cloudDownloadPreference").addEventListener("click", this);
  },

  _addRadioOption(key, providerName, document) {
    const option = document.createElement("radio");
    option.id = key;
    option.type = "radio";

    option.setAttribute("class", "panelCloudNotificationUI-radio");
    option.setAttribute("label", "Save to " + providerName);
    option.setAttribute("provider", this._formatProviderName(providerName));
    return option;
  },

  _addNotificationMultipleProviders(providersMap, document) {
    const multiProviderSelect = document.getElementById("multiProviderSelect");

    const providers = [];
    providersMap.forEach((value, key) => {
      providers.push({"key": key, "name": value.displayName});
    });

    // Reset multiProviderSelect by removing any previous
    // added options
    while (multiProviderSelect.firstChild) {
      multiProviderSelect.firstChild.remove();
    }

    for (const provider of providers) {
      multiProviderSelect.appendChild(
        this._addRadioOption(provider.key, provider.name, document));
    }
    multiProviderSelect.removeAttribute("hidden");
  },

  _iconURL(name) {
    if (this._formatProviderName(name) === "localdownloads") {
      return "moz-icon://" + CloudDownloadsInternal.defaultDownloadDirIconURL + "?size=16";
    }
    return new URL(this.stylesURL).origin + "/skin/" + this._formatProviderName(name) + ".svg";
  },

  _setMenuItemAttributes(menuItem, providerKey, providerDetail) {
    menuItem.setAttribute("label", providerDetail.displayName);
    menuItem.setAttribute("providerKey", providerKey);
    menuItem.setAttribute("class", "menuitem-iconic");
    menuItem.setAttribute("image", this._iconURL(providerDetail.displayName));
    menuItem.removeAttribute("hidden");
    return menuItem;
  },

  _setMoveDownloadMenuPopUpAttributes(menuItem) {
    menuItem.removeAttribute("hidden");
    const menuPopup = menuItem.menupopup;
    menuPopup.removeAttribute("hidden");
    return menuPopup.firstChild;
  },

  _displayMoveToCloudContextMenuItem(downloadElement) {
    const aPopupMenu = downloadElement.ownerDocument.getElementById("downloadsContextMenu");
    let menuItem = aPopupMenu.getElementsByAttribute("id", "moveDownload")[0];
    if (menuItem) {
      menuItem.setAttribute("hidden", "true");

      // Exit if user has opted to store subsequent downloads in cloud provider folder
      if (CloudDownloadsInternal.preferredProviderKey) {
        return;
      }

      if (CloudDownloadsInternal.checkIfExistingCloudProviderDownloadSettings()) {
        return;
      }

      const downloadType = downloadElement.getAttribute("cloudstorage");
      // Downloaded Item is saved in local downloads folder
      if (this.providers.size > 1) {
        let subMenuItem =  this._setMoveDownloadMenuPopUpAttributes(menuItem);
        this.providers.forEach((value, key) => {
          if (this._formatProviderName(value.displayName) === downloadType) {
            subMenuItem.setAttribute("hidden", "true");
          } else {
            subMenuItem = this._setMenuItemAttributes(subMenuItem, key, value);
          }
          subMenuItem = subMenuItem.nextSibling;
        });

        if (downloadType === "localdownloads") {
          subMenuItem.setAttribute("hidden", "true");
        } else {
          subMenuItem = this._setMenuItemAttributes(subMenuItem, "localdownloads", {displayName: "Local Downloads"});
        }
      } else {
        const provider = downloadType != "localdownloads" ?
          ["localdownloads", {displayName: "Local Downloads"}] : this.providers.entries().next().value;
        menuItem = this._setMenuItemAttributes(menuItem, provider[0], provider[1]);
        menuItem.setAttribute("label", "Move To " + provider[1].displayName);
      }
    }
  },

  handleEvent(event) {
    // Handle rendering right provider in context menu when shown
    if (event.type === "popupshowing") {
      const element = event.target.triggerNode;
      if (!element) {
        return;
      }

      if (event.target.triggerNode.parentNode.id !== "downloadsListBox") {
        const menuItem = event.target.getElementsByAttribute("id", "moveDownload")[0];
        if (menuItem) {
          menuItem.setAttribute("hidden", "true");
        }
        return;
      }
      this._displayMoveToCloudContextMenuItem(element);
    }

    // Handle multiple provider displayed as options in notification
    if (event.target.parentElement.id === "multiProviderSelect") {
      const cloudDownloadSave = event.currentTarget.querySelector("#cloudDownloadSave");
      cloudDownloadSave.setAttribute("label", event.target.label);
      cloudDownloadSave.setAttribute("providerKey", event.target.id);
      cloudDownloadSave.removeAttribute("disabled");
      return;
    }

    let telemetryData = null;

    if (event.target.id === "moveDownload" || event.target.parentElement.id === "moveDownloadSubMenu") {
      const providerKey = event.target.getAttribute("providerKey");
      if (!providerKey) {
        return;
      }

      const downloadsEl = event.target.parentNode.triggerNode;
      const download = downloadsEl.ownerGlobal.DownloadsView.itemForElement(downloadsEl).download;

      // Check if there is a download to be moved to provider folder, if not exit
      if (!download) {
        return;
      }

      // If clicked menu item is 'Move to Local Downloads' with providerKey attribute as 'localdownloads'
      // invoke handleLocalMove to move download to user default download directoty
      if (providerKey === "localdownloads") {
        CloudDownloadsInternal.handleLocalMove(download);
      } else {
        CloudDownloadsInternal.selectedProvider = { providerKey, value: this.providers.get(providerKey) };
        CloudDownloadsInternal.handleMove(download);
      }
      telemetryData = {
        message: "prompt_move_download_context_menu",
        provider: providerKey,
        provider_count: this.providers.size.toString(),
      };
      this.eventEmitter.emit("record-telemetry", telemetryData);
      return;
    }

    switch (event.target.id) {
    case "cloudDownloadSave":
      if (!event.target.getAttribute("disabled")) {
        const providerKey = event.target.getAttribute("providerKey");
        CloudStorage.savePromptResponse(providerKey, true, true);
        CloudDownloadsInternal.selectedProvider = { providerKey, value: this.providers.get(providerKey) };
        // Prepare for future downloads move to Download Folder by checking
        // if Download folder exists in cloud provider folder, if not create one
        CloudDownloadsInternal.checkProviderDownloadFolder();

        // Access lazy preference getter property first time so that subsequent updates
        // in respective preferences trigger preference observer.
        CloudDownloadsInternal.useDownloadDirPref;
        CloudDownloadsInternal.folderListPref;

        telemetryData = {
          message: "prompt_opted_in",
          provider: providerKey,
          provider_count: this.providers.size.toString(),
        };
        this.eventEmitter.emit("record-telemetry", telemetryData);
        event.currentTarget.setAttribute("hidden", "true");
      }
      break;
    case "cloudDownloadCancel": {
      // Set interval when notification was last shown
      const timestamp = Math.floor(Date.now() / 1000);
      Services.prefs.setIntPref(CLOUD_SERVICES_PREF + "lastprompt", timestamp);
      telemetryData = {
        message: "prompt_cancel_click",
        provider_count: this.providers.size.toString(),
      };
      this.eventEmitter.emit("record-telemetry", telemetryData);
      event.currentTarget.setAttribute("hidden", "true");
      break;
    }
    case "cloudDownloadPreference": {
      const origin = null;
      const entryPoint = "CloudStorage";
      this.getRecentWindow().openPreferences("paneGeneral", {origin, urlParams: {entrypoint: entryPoint}});
      telemetryData = {
        message: "prompt_preferences",
      };
      this.eventEmitter.emit("record-telemetry", telemetryData);
      break;
    }
    }
  },
};


// Cloud Downloads Internal API that observe downloads and handle
// downloaded item move once user selects Move to provider folder context menu option
var CloudDownloadsInternal = {
  /**
   * Provider selected in context menu
   */
  selectedProvider: null,

  /**
    * Icon URL shown before default Local Download Dir in context menu
    */
  defaultDownloadDirIconURL: null,

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

  checkIfExistingCloudProviderDownloadSettings() {
    // Check if user has previously set preferred download directoy path as
    // one of cloud provider folder, if yes exit without showing notification
    // Telemetry - how many such users
    if (!CloudDownloadsView.providers) {
      return false;
    }

    const dwnldDirPath = this.downloadDirSetting;
    const providerValues = [...CloudDownloadsView.providers.values()];
    return providerValues.some(v => dwnldDirPath.includes(v.downloadPath));
  },

  async _setDefaultDownloadDirIconURL() {
    const downloadsDir = await Downloads.getPreferredDownloadsDirectory();

    // Used in defining the correct path to the folder icon.
    const fph = Services.io.getProtocolHandler("file")
      .QueryInterface(Ci.nsIFileProtocolHandler);

    this.defaultDownloadDirIconURL = fph.getURLSpecFromFile(new FileUtils.File(downloadsDir));
  },

  /**
   * Moves downloaded item to provider download folder and adds
   * moved file in provider folder as a download item in DownloadList
   * object shown in user interface in Download Panel and Download History
   *
   * @param download
   *        object representing a single download
   * @param providerDwnldFldrPath
   *        String with complete path of provider download folder
   * @return {Promise} that resolves successfully once download is moved
   *         to provider folder and movedDownload is added as download item
   *         in DownloadList object
   */

  async _moveDownload(download, providerDwnldFldrPath) {
    // String with complete original target path of download
    const dwnldTargetPath = download.target.path;
    let destPath = providerDwnldFldrPath ?
      OS.Path.join(providerDwnldFldrPath, OS.Path.basename(dwnldTargetPath)) : "";

    // Ensure destPath is a unique file
    const destDir = DownloadPaths.createNiceUniqueFile(new FileUtils.File(destPath));
    destPath = destDir.path;

    try {
      await OS.File.move(dwnldTargetPath, destPath);
    } catch (err) {
      Cu.reportError(err);
      return;
    }

    // Create a duplicate download which will show the correct
    // target path for moved session download in Download UI panel
    const publicList = await Downloads.getList(Downloads.ALL);

    const movedDownload = await Downloads.createDownload({
      source: download.source,
      target: destPath
    });
    movedDownload.startTime = download.startTime;
    movedDownload.succeeded = true;
    await publicList.add(movedDownload);

    try {
      // Update destination path used in download history library panel
      PlacesUtils.annotations.setPageAnnotation(
        NetUtil.newURI(download.source.url),
        "downloads/destinationFileURI",
        Services.io.newFileURI(destDir).spec, 0,
        PlacesUtils.annotations.EXPIRE_WITH_HISTORY);
    } catch (err) {
      // Catch errors thrown during setPageAnnotation - Bug 1298362
      // Fixes Issue #34
    }

    // Explicitly updates the state of a moved download
    movedDownload.refresh().catch(Cu.reportError);

    // Remove original download in favor of moved download from download UI panel
    await publicList.remove(download);
  },

  async checkProviderDownloadFolder() {
    if (!this.selectedProvider) {
      return null;
    }
    // Compute provider download folder path from selectedProvider object
    const providerDownloadFolder = OS.Path.join(this.selectedProvider.value.downloadPath,
      this.selectedProvider.value.typeSpecificData.default);

    // create download directory if it doesn't exist
    try {
      await OS.File.makeDir(providerDownloadFolder, {ignoreExisting: true});
    } catch (err) {
      Cu.reportError(err);
      return null;
    }
    return providerDownloadFolder;
  },

  async handleMove(download) {
    const providerDownloadFolder = await this.checkProviderDownloadFolder();
    if (download.succeeded) {
      await this._moveDownload(download, providerDownloadFolder);
    }
  },

  async handleLocalMove(download) {
    const downloadsDir = await Downloads.getPreferredDownloadsDirectory();
    const downloadsDirExists = await this.checkIfAssetExists(downloadsDir);
    if (downloadsDirExists) {
      if (download.succeeded) {
        await this._moveDownload(download, downloadsDir);
      }
    }
  },

  /**
   * In preferences UI, under Downloads, user can opt-out of cloud storage.
   * Observe download preferences and notify telemetry if user is 'opted_in'
   * or 'opted_out' of cloud storage.
   */
  downloadPrefObserve() {
    // Once opted-in, set send subsequent download pref changes to telemetry
    if (this.preferredProviderKey) {
      const telemetryData = {
        message: "download_prefs",
        cloud_storage_state: (this.folderListPref === 3 && this.useDownloadDirPref) ? "opted_in" : "opted_out",
      };
      CloudDownloadsView.eventEmitter.emit("record-telemetry", telemetryData);
    }
  }
};


var WindowListener = {
  setupBrowserUI: function wm_setupBrowserUI(window) {
    const utils = window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
    utils.loadSheetUsingURIString(CloudDownloadsView.stylesURL, Ci.nsIDOMWindowUtils.AUTHOR_SHEET);
  },

  tearDownBrowserUI: function wm_tearDownBrowserUI(window) {
    const utils = window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
    utils.removeSheetUsingURIString(CloudDownloadsView.stylesURL, Ci.nsIDOMWindowUtils.AUTHOR_SHEET);
  },

  // nsIWindowMediatorListener functions
  onOpenWindow: function wm_onOpenWindow(xulWindow) {
    // A new window has opened
    const domWindow = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIDOMWindow);

    // Wait for it to finish loading
    domWindow.addEventListener("load", async function listener() {
      // If this is a browser window or places library window then setup its UI
      if (domWindow.document.documentElement.getAttribute("windowtype") === "navigator:browser" ||
          domWindow.document.documentElement.getAttribute("windowtype") === "Places:Organizer" ) {
        if (!CloudDownloadsView.stylesURL) {
          return;
        }
        WindowListener.setupBrowserUI(domWindow);

        const moveDownloadMenuItem = domWindow.document.getElementById("moveDownload");
        if (moveDownloadMenuItem) {
          return;
        }
        await CloudDownloadsView.registerContextMenu(domWindow);
      }
    }, {once: true});
  },
};

/**
 * generic pref that shows if cloud storage API is in use, by default set to false.
 */
XPCOMUtils.defineLazyPreferenceGetter(CloudDownloadsView, "gIsAPIEnabled",
  CLOUD_SERVICES_PREF + "api.enabled", false, () => CloudDownloadsView.toggleAPIEnabledState());

XPCOMUtils.defineLazyPreferenceGetter(CloudDownloadsInternal, "downloadDirSetting",
  "browser.download.dir", "", () => CloudDownloadsInternal._setDefaultDownloadDirIconURL());

XPCOMUtils.defineLazyPreferenceGetter(CloudDownloadsInternal, "preferredProviderKey",
  CLOUD_SERVICES_PREF + "storage.key", "");

XPCOMUtils.defineLazyPreferenceGetter(CloudDownloadsInternal, "useDownloadDirPref",
  "browser.download.useDownloadDir", true, () => CloudDownloadsInternal.downloadPrefObserve());

XPCOMUtils.defineLazyPreferenceGetter(CloudDownloadsInternal, "folderListPref",
  "browser.download.folderList", 1, () => CloudDownloadsInternal.downloadPrefObserve());

CloudDownloadsView.toggleAPIEnabledState();
