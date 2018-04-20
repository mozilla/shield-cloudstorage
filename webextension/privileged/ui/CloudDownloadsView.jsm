ChromeUtils.import("resource://gre/modules/Services.jsm");
ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
ChromeUtils.defineModuleGetter(this, "CloudStorage", "resource://gre/modules/CloudStorage.jsm");
ChromeUtils.defineModuleGetter(this, "Downloads", "resource://gre/modules/Downloads.jsm");
ChromeUtils.defineModuleGetter(this, "DownloadPaths", "resource://gre/modules/DownloadPaths.jsm");
ChromeUtils.defineModuleGetter(this, "FileUtils", "resource://gre/modules/FileUtils.jsm");
ChromeUtils.defineModuleGetter(this, "NetUtil", "resource://gre/modules/NetUtil.jsm");
ChromeUtils.defineModuleGetter(this, "OS", "resource://gre/modules/osfile.jsm");
ChromeUtils.defineModuleGetter(this, "PlacesUtils", "resource://gre/modules/PlacesUtils.jsm");
ChromeUtils.defineModuleGetter(this, "RecentWindow", "resource:///modules/RecentWindow.jsm");

const EXPORTED_SYMBOLS = ["CloudDownloadsView"];
const CLOUD_SERVICES_PREF = "cloud.services.";
const CLOUD_PROVIDER_DEFAULT_ICON = "default";
const Ci = Components.interfaces;

const CloudDownloadsView = {
  isInitialized: false,
  stylesURL: null,
  providers: null,
  notificationHTML: `
    <hbox>
      <image id='cloudDownloadTypeIcon'/>
      <vbox id='cloudDownloadContainer'>
        <description id='cloudDownloadTitle'/>
        <hbox>
          <description id='cloudDownloadDetail'/>
          <label id='cloudDownloadPreference' class='text-link'/>
        </hbox>
        <radiogroup id='multiProviderSelect'/>
      </vbox>
    </hbox>
    <hbox>
      <button id='cloudDownloadCancel' />
      <button id='cloudDownloadSave' default='true'/>
    </hbox>`,

  get browserWindow() {
    return RecentWindow.getMostRecentBrowserWindow();
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
        providers.delete(GDRIVE_KEY);
      }
    }
    return providers;
  },

  async registerContextMenu(browserWindow) {
    if (!browserWindow || !browserWindow.document) {
      return;
    }

    // Invoke getDownloadFolder on CloudStorage API to ensure API is initialized
    // This is workaround to force initialize API for first time enter to
    // ensure getStorageProviders call returns successfully.
    await CloudStorage.getDownloadFolder();
    const providers = await CloudStorage.getStorageProviders();
    this.providers = await this._filterProvidersMap(providers);

    // Continue only if cloud providers exists on user device
    if (this.providers.size === 0) {
      return;
    }

    const aPopupMenu = browserWindow.document.getElementById("downloadsContextMenu");
    if (!aPopupMenu) {
      return;
    }

    // Get menuItem Copy Location, to insert skeleton move download option and a menu separator after it
    const menuItem = aPopupMenu.getElementsByAttribute("command", "downloadsCmd_copyLocation")[0];
    if (!menuItem) {
      return;
    }

    const fragment = browserWindow.document.createDocumentFragment();
    const separator = browserWindow.document.createElement("menuseparator");
    separator.setAttribute("id", "moveDownloadSeparator");
    fragment.appendChild(separator);

    if (this.providers.size > 1) {
      const moveDownloadMenu = browserWindow.document.createElement("menu");
      moveDownloadMenu.setAttribute("id", "moveDownload");
      moveDownloadMenu.setAttribute("hidden", "true");
      const moveDownloadMenuPopup = browserWindow.document.createElement("menupopup");
      moveDownloadMenuPopup.setAttribute("id", "moveDownloadSubMenu");
      moveDownloadMenuPopup.setAttribute("hidden", "true");

      this.providers.forEach((value, key) => {
        const moveDownloadItem = browserWindow.document.createElement("menuitem");
        moveDownloadMenuPopup.appendChild(moveDownloadItem);
      });

      moveDownloadMenu.appendChild(moveDownloadMenuPopup);
      fragment.appendChild(moveDownloadMenu);
    } else {
      // Add skeleton Move to menu item in context menu
      const moveDownloadItem = browserWindow.document.createElement("menuitem");
      moveDownloadItem.setAttribute("id", "moveDownload");
      moveDownloadItem.setAttribute("hidden", "true");
      fragment.appendChild(moveDownloadItem);
    }
    aPopupMenu.insertBefore(fragment, menuItem.nextSibling);
    aPopupMenu.addEventListener("click", this);
    const dwnldsListBox = browserWindow.document.getElementById("downloadsListBox");
    dwnldsListBox.addEventListener("contextmenu", this);
  },

  unRegisterContextMenu() {
    const browserWindow = this.browserWindow;

    const moveDownloadMenuItem = browserWindow.document.getElementById("moveDownload");
    if (!moveDownloadMenuItem) {
      return;
    }

    const aPopupMenu = browserWindow.document.getElementById("downloadsContextMenu");
    aPopupMenu.removeEventListener("click", this);
    aPopupMenu.removeChild(moveDownloadMenuItem);

    const moveDownloadSeparator = browserWindow.document.getElementById("moveDownloadSeparator");
    aPopupMenu.removeChild(moveDownloadSeparator);

    const dwnldsListBox = browserWindow.document.getElementById("downloadsListBox");
    dwnldsListBox.removeEventListener("contextmenu", this);
  },

  registerNotification() {
    Services.obs.addObserver(this.observe, "cloudstorage-prompt-notification");
    this.isInitialized = true;
  },

  unRegisterNotification() {
    Services.obs.removeObserver(this.observe, "cloudstorage-prompt-notification");
    this.isInitialized = false;
    const browserWindow = this.browserWindow;
    const panelCloudNotification = browserWindow.document.getElementById("panelCloudNotification");
    if (!panelCloudNotification) {
      return;
    }
    panelCloudNotification.removeEventListener("click", this);

    const panelDownload = browserWindow.document.getElementById("downloadsPanel-mainView");
    panelDownload.removeChild(panelCloudNotification);
  },

  async initWindowListener() {
    // Get the list of browser windows already open
    const windows = Services.wm.getEnumerator("navigator:browser");
    while (windows.hasMoreElements()) {
      const domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
      WindowListener.setupBrowserUI(domWindow);
      const moveDownloadMenuItem = domWindow.document.getElementById("moveDownload");
      if (moveDownloadMenuItem) {
        return;
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
      WindowListener.tearDownBrowserUI(domWindow);
      this.unRegisterContextMenu();
    }
    // Stop listening for any new browser windows to open
    Services.wm.removeListener(WindowListener);
  },

  async init() {
    if (!this.gIsAPIEnabled) {
      if (this.isInitialized) {
        this.unRegisterNotification();
        this.uninitWindowListener();
      }
      return;
    }
    await this.initWindowListener();
    this.registerNotification();
  },

  async observe(subject, topic, data) {
    switch (topic) {
    case "cloudstorage-prompt-notification":
      await CloudDownloadsView.showNotification();
      break;
    }
  },

  async _checkIfExistingCloudProviderDownloadSettings() {
    // Check if user has previously set preferred download directoy path as
    // one of cloud provider folder, if yes exit without showing notification
    // TBD: Telemetry - how many such users
    const dwnldDirPath = await Downloads.getPreferredDownloadsDirectory();
    let hasExistingCloudDwnldDir = false;
    this.providers.forEach((value, key) => {
      if (dwnldDirPath.includes(value.downloadPath)) {
        hasExistingCloudDwnldDir = true;
      }
    });
    if (hasExistingCloudDwnldDir) {
      return true;
    }
    return false;
  },

  async showNotification() {
    const browserWindow = this.browserWindow;

    if (!browserWindow || !browserWindow.document) {
      return;
    }

    const panelDownload = browserWindow.document.getElementById("downloadsPanel-mainView");
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

    if (await this._checkIfExistingCloudProviderDownloadSettings()) {
      return;
    }

    let panelCloudNotification = browserWindow.document.getElementById("panelCloudNotification");
    if (panelCloudNotification) {
      if (!panelCloudNotification.getAttribute("show")) {
        panelCloudNotification.setAttribute("show", "true");
      }
      return;
    }

    let providerDisplayName = null;
    let providerIcon = null;
    let providerKey = null;
    const document = browserWindow.document;

    const fragment = document.createDocumentFragment();
    panelCloudNotification = document.createElement("vbox");
    panelCloudNotification.setAttribute("id", "panelCloudNotification");
    panelCloudNotification.unsafeSetInnerHTML(this.notificationHTML);
    fragment.appendChild(panelCloudNotification);
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

    document.getElementById("cloudDownloadTitle").setAttribute("value", `Save downloads to ${ providerDisplayName }?`);
    document.getElementById("cloudDownloadTypeIcon").setAttribute("data-provider-icon", providerIcon);
    document.getElementById("cloudDownloadDetail").setAttribute("value", "Change your download settings any time in");
    document.getElementById("cloudDownloadPreference").setAttribute("value", "Preferences.");

    const cloudDownloadSave = document.getElementById("cloudDownloadSave");
    cloudDownloadSave.setAttribute("label", `Save to ${ providerDisplayName}`);
    cloudDownloadSave.setAttribute("providerKey", providerKey);

    if (providerIcon === CLOUD_PROVIDER_DEFAULT_ICON) {
      cloudDownloadSave.setAttribute("disabled", true);
    } else {
      cloudDownloadSave.removeAttribute("disabled");
    }

    document.getElementById("cloudDownloadCancel").setAttribute("label", "Not Now");
    panelCloudNotification.setAttribute("show", "true");
    panelCloudNotification.addEventListener("click", this);
  },

  _addRadioOption(key, providerName, document) {
    const option = document.createElement("radio");
    option.id = key;
    option.type = "radio";

    option.setAttribute("label", `Save to ${ providerName}`);
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
    multiProviderSelect.setAttribute("show", "true");
  },

  _iconURL(name) {
    if (this._formatProviderName(name) === "localdownload") {
      return `moz-icon://${ CloudDownloadsInternal.defaultDownloadDirIconURL }?size=16`;
    }
    return `${new this.browserWindow.URL(this.stylesURL).origin }/skin/${ this._formatProviderName(name) }.svg`;
  },

  _listDownloadItemIndex(element) {
    const children = element.parentNode.childNodes;
    for (let i = 0; i < children.length; i++) {
      if (children[i] === element) {
        return i;
      }
    }
    return -1;
  },

  _setMenuItemAttributes(menuItem, providerKey, providerDetail, downloadElement) {
    menuItem.setAttribute("label", providerDetail.displayName);
    menuItem.setAttribute("providerKey", providerKey);
    menuItem.setAttribute("class", "menuitem-iconic");
    menuItem.setAttribute("image", this._iconURL(providerDetail.displayName));
    menuItem.setAttribute("itemIndex", this._listDownloadItemIndex(downloadElement));
    return menuItem;
  },

  _setMoveDownloadMenuPopUpAttributes(menuItem) {
    menuItem.setAttribute("label", "Move Download To...");
    menuItem.removeAttribute("hidden");
    const menuPopup = menuItem.menupopup;
    menuPopup.removeAttribute("hidden");
    return menuPopup.firstChild;
  },

  async _displayMoveToCloudContextMenuItem(downloadElement) {
    const aPopupMenu = this.browserWindow.document.getElementById("downloadsContextMenu");
    let menuItem = aPopupMenu.getElementsByAttribute("id", "moveDownload")[0];
    if (menuItem) {
      menuItem.setAttribute("hidden", "true");

      // Exit if user has opted to store subsequent downloads in cloud provider folder
      if (CloudDownloadsInternal.preferredProviderKey) {
        return;
      }

      if (await this._checkIfExistingCloudProviderDownloadSettings()) {
        return;
      }

      const downloadType = downloadElement._shell.element.getAttribute("cloudstorage");
      // Downloaded Item is saved in local download folder
      if (downloadType === "local") {
        if (this.providers.size > 1) {
          let subMenuItem =  this._setMoveDownloadMenuPopUpAttributes(menuItem);
          this.providers.forEach((value, key) => {
            subMenuItem = this._setMenuItemAttributes(subMenuItem, key, value, downloadElement);
            subMenuItem = subMenuItem.nextSibling;
          });
        } else {
          // Display available provider as context menu option
          const provider = this.providers.entries().next().value;
          menuItem = this._setMenuItemAttributes(menuItem, provider[0], provider[1], downloadElement);
          menuItem.setAttribute("label", `Move To ${ provider[1].displayName}`);
          menuItem.removeAttribute("hidden");
        }
      } else {
        // Downloaded Item is saved in cloud storage provider folder

        // Find local prefereed download directory path
        // to display correct icon in Local Download context menu option
        await CloudDownloadsInternal._setDefaultDownloadDirIconURL();

        // Display context menus for download saved in cloud provider folder
        if (this.providers.size > 1) {
          let subMenuItem =  this._setMoveDownloadMenuPopUpAttributes(menuItem);
          this.providers.forEach((value, key) => {
            if (this._formatProviderName(value.displayName) !== downloadType) {
              subMenuItem = this._setMenuItemAttributes(subMenuItem, key, value, downloadElement);
              subMenuItem = subMenuItem.nextSibling;
            }
          });
          subMenuItem = this._setMenuItemAttributes(subMenuItem, "local", {displayName: "Local Download"}, downloadElement);
        } else {
          menuItem = this._setMenuItemAttributes(menuItem, "local", {displayName: "Local Download"}, downloadElement);
          menuItem.setAttribute("label", "Move To Local Download");
          menuItem.removeAttribute("hidden");
        }
      }
    }
  },

  handleEvent(event) {
    // Handle multiple provider displayed as options in notification
    if (event.target.parentElement.id === "multiProviderSelect") {
      const cloudDownloadSave = event.currentTarget.children[1].children.cloudDownloadSave;
      cloudDownloadSave.setAttribute("label", event.target.label);
      cloudDownloadSave.setAttribute("providerKey", event.target.id);
      cloudDownloadSave.removeAttribute("disabled");
      return;
    }

    // Handle rendering right provider in context menu when shown
    if (event.type === "contextmenu" && event.currentTarget.id === "downloadsListBox") {
      const element = event.currentTarget.selectedItem;
      if (!element) {
        return;
      }
      this._displayMoveToCloudContextMenuItem(element);
    }

    if (event.target.id === "moveDownload" || event.target.parentElement.id === "moveDownloadSubMenu") {
      const key = event.target.getAttribute("providerKey");
      if (key === "local") {
        CloudDownloadsInternal.handleLocalMove(event.target);
      } else {
        CloudDownloadsInternal.selectedProvider = { key, value: this.providers.get(key) };
        CloudDownloadsInternal.handleMove(event.target);
      }
      return;
    }

    switch (event.target.id) {
    case "cloudDownloadSave":
      if (!event.target.getAttribute("disabled")) {
        const key = event.target.getAttribute("providerKey");
        CloudStorage.savePromptResponse(key, true, true);
        CloudDownloadsInternal.selectedProvider = { key, value: this.providers.get(key) };
        // Invoke handleMove to prepare future downloads move to Download Folder by checking
        // if Download folder exists in cloud provider folder, if not create one
        CloudDownloadsInternal.handleMove();
        event.currentTarget.removeAttribute("show");
      }
      break;
    case "cloudDownloadCancel":
      // Set interval when notification was last shown
      Services.prefs.setIntPref(`${CLOUD_SERVICES_PREF }lastprompt`,
        Math.floor(Date.now() / 1000));
      event.currentTarget.removeAttribute("show");
      break;
    case "cloudDownloadPreference":
    {
      const origin = null;
      const entryPoint = "CloudStorage";
      this.browserWindow.openPreferences("paneGeneral", {origin, urlParams: {entrypoint: entryPoint}});
      break;
    }
    }
  },
};


// Cloud Downloads Internal API that observe downloads and handle
// downloaded item move once user selects Move to provider folder context menu option
const CloudDownloadsInternal = {
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
    destPath = DownloadPaths.createNiceUniqueFile(new FileUtils.File(destPath)).path;

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

    // Update destination path used in download history library panel
    PlacesUtils.annotations.setPageAnnotation(
      NetUtil.newURI(download.source.url),
      "downloads/destinationFileURI",
      `file://${ destPath}`, 0,
      PlacesUtils.annotations.EXPIRE_WITH_HISTORY);

    // Explicitly updates the state of a moved download
    movedDownload.refresh().catch(Cu.reportError);

    // Remove original download in favor of moved download from download UI panel
    await publicList.remove(download);
  },

  async handleMove(moveDownloadMenuItem) {
    if (!this.selectedProvider) {
      return;
    }

    // Compute provider download folder path from selectedProvider object
    const providerDownloadFolder = OS.Path.join(this.selectedProvider.value.downloadPath,
      this.selectedProvider.value.typeSpecificData.default);

    // create download directory if it doesn't exist
    try {
      await OS.File.makeDir(providerDownloadFolder, {ignoreExisting: true});
    } catch (err) {
      Cu.reportError(err);
      return;
    }

    // Check if there is a download item to be moved to provider folder, if not exit
    if (!moveDownloadMenuItem) {
      return;
    }

    const document = CloudDownloadsView.browserWindow.document;
    const downloadItemElements = document.getElementById("downloadsListBox").childNodes;
    const download = downloadItemElements[moveDownloadMenuItem.getAttribute("itemIndex")]._shell.download;
    if (download.succeeded) {
      await this._moveDownload(download, providerDownloadFolder);
    }
  },

  async handleLocalMove(moveDownloadMenuItem) {
    const downloadsDir = await Downloads.getPreferredDownloadsDirectory();
    const downloadsDirExists = await this.checkIfAssetExists(downloadsDir);
    if (downloadsDirExists) {
      const document = CloudDownloadsView.browserWindow.document;
      const downloadItemElements = document.getElementById("downloadsListBox").childNodes;
      const download = downloadItemElements[moveDownloadMenuItem.getAttribute("itemIndex")]._shell.download;
      if (download.succeeded) {
        await this._moveDownload(download, downloadsDir);
      }
    }
  },
};

const WindowListener = {
  setupBrowserUI: function wm_setupBrowserUI(window) {
    const utils = window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
    utils.loadSheetUsingURIString(CloudDownloadsView.stylesURL, Ci.nsIDOMWindowUtils.AGENT_SHEET);
  },

  tearDownBrowserUI: function wm_tearDownBrowserUI(window) {
    const utils = window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
    utils.removeSheetUsingURIString(CloudDownloadsView.stylesURL, Ci.nsIDOMWindowUtils.AGENT_SHEET);
  },

  // nsIWindowMediatorListener functions
  onOpenWindow: function wm_onOpenWindow(xulWindow) {
    // A new window has opened
    const domWindow = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIDOMWindow);

    // Wait for it to finish loading
    domWindow.addEventListener("load", async function listener() {
      // If this is a browser window or places library window then setup its UI
      const windowtype = domWindow.document.documentElement.getAttribute("windowtype");
      if (windowtype === "navigator:browser" || windowtype === "Places:Organizer" ) {
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
  `${CLOUD_SERVICES_PREF }api.enabled`, false, () => CloudDownloadsView.init());

XPCOMUtils.defineLazyPreferenceGetter(CloudDownloadsInternal, "preferredProviderKey",
  `${CLOUD_SERVICES_PREF }storage.key`, "");

CloudDownloadsView.promiseInit = CloudDownloadsView.init();
