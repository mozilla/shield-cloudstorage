/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Handles the Cloud Downloads UI in download panel.
 */

"use strict";

ChromeUtils.import("resource://gre/modules/Services.jsm");
ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
ChromeUtils.defineModuleGetter(this, "CloudStorage",
                               "resource://gre/modules/CloudStorage.jsm");
ChromeUtils.defineModuleGetter(this, "RecentWindow",
                               "resource:///modules/RecentWindow.jsm");

const CLOUD_SERVICES_PREF = "cloud.services.";
const CLOUD_PROVIDER_DEFAULT_ICON = "default";

this.ui = class extends ExtensionAPI {
  getAPI(context) {
    return {
      ui: {
        async init() {
          CloudDownloadsView.init();
          return "initialised";
        },
        async setStylesURL(path) {
          CloudDownloadsView.stylesURL = path;
          return path;
        },
        async setCloudProperties(path) {
          CloudDownloadsView.propertiesURL = path;
          return path;
        }
      }
    };
  }
};

 var CloudDownloadsView = {
  isInitialized: false,
  stylesURL: null,
  propertiesURL: null,

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
          <button id='cloudDownloadCancel' class='cloudNotificationButton'/>
          <button id='cloudDownloadSave' class='cloudNotificationButton' default='true'/>
        </hbox>
        <hbox id='syncSignIn' class='cloudDownloadSyncMessage'>
          <label id='syncSignInLink' class='text-link'/>
          <description id='cloudDownloadSignInText'/>
        </hbox>
        <hbox id='syncMessage' class='cloudDownloadSyncMessage'>
          <description id='cloudDownloadSyncText'/>
        </hbox>`,

  get browserWindow() {
    return RecentWindow.getMostRecentBrowserWindow();
  },

  getString(key) {
    return CloudDownloadsView.gCloudDownloadsBundle.GetStringFromName(key);
  },

  getFormattedString(key, params) {
    return CloudDownloadsView.gCloudDownloadsBundle.formatStringFromName(key, params, params.length);
  },

  formatProviderName(name) {
    return name.toLowerCase().replace(" ", "");
  },

  registerNotification() {
    Services.obs.addObserver(this.observe, "cloudstorage-prompt-notification");
    this.isInitialized = true;
  },

  unRegisterNotification() {
    Services.obs.removeObserver(this.observe, "cloudstorage-prompt-notification");
    RecentWindow.getMostRecentBrowserWindow().document.getElementById("panelCloudNotification").
      removeEventListener("click", this);
    this.isInitialized = false;
  },

  observe(subject, topic, data) {
    switch (topic) {
      case "cloudstorage-prompt-notification":
        CloudDownloadsView.showNotification();
        break;
    }
  },

  init() {
    if (!this.gIsAPIEnabled) {
      if (this.isInitialized) {
        this.unRegisterNotification();
      }
      return;
    }
    this.registerNotification();
  },

  showNotification() {
    this.initUI();
  },

  async initUI() {
    let browserWindow = this.browserWindow;

    if (!browserWindow || !browserWindow.document) {
      return;
    }

    let panelDownload = browserWindow.document.getElementById("downloadsPanel-mainView");
    if (!panelDownload) {
      return;
    }

    // Check if user had already opted-in or
    // enough time has passed since last prompts shown

    // TBD: optimize by implementing lastpromptshown check, getPreferredProvider from cloud storage
    if (!await CloudStorage.promisePromptInfo()) {
      return;
    }

    let providersMap = await CloudStorage.getStorageProviders();

    // Continue only if cloud providers exists on user device
    if (providersMap.size === 0) {
      return;
    }

    // TBD: check if user has browser.download.dir set to one of the default download paths
    // If yes don't continue

    let providerDisplayName = null;
    let providerIcon = null;
    let providerKey = null;
    let document = browserWindow.document;

    let aStylesheetURL = this.stylesURL;

    let contentStylesheet = document.createProcessingInstruction(
      "xml-stylesheet",
      'href="' + aStylesheetURL + '" type="text/css"'
      );

    document.insertBefore(contentStylesheet,
                          document.documentElement);


    let f = document.createDocumentFragment();
    let panelCloudNotification = document.createElement('vbox');
    panelCloudNotification.setAttribute('id', 'panelCloudNotification');
    panelCloudNotification.unsafeSetInnerHTML(this.notificationHTML);
    f.appendChild(panelCloudNotification);

    panelDownload.prepend(f);
    //<vbox id='panelCloudNotification'>\

    if (providersMap.size > 1 ) {
      this.handleMultipleProviders(providersMap, document);
      providerDisplayName = "cloud storage"; //this.getString("cloud.download.storage");
      providerIcon = CLOUD_PROVIDER_DEFAULT_ICON;
    } else {
      let provider = providersMap.entries().next().value;
      providerDisplayName = provider[1].displayName;
      providerKey = provider[0];
      providerIcon = this.formatProviderName(providerDisplayName);
    }

    document.getElementById("cloudDownloadTitle").setAttribute("value", "Save downloads to " + providerDisplayName + "?");
      //this.getFormattedString("cloud.download.notification.title", [providerDisplayName]));

    document.getElementById("cloudDownloadTypeIcon").setAttribute("data-provider-icon", providerIcon);

    document.getElementById("cloudDownloadDetail").setAttribute("value", "Change your download settings any time in");
   //   this.getString("cloud.download.notification.detail"));

    document.getElementById("cloudDownloadPreference").setAttribute("value", "Preferences.");
     // this.getString("cloud.download.preferences"));

    let cloudDownloadSave = document.getElementById("cloudDownloadSave");
    cloudDownloadSave.setAttribute("label", "Save to " + providerDisplayName);
   //   this.getFormattedString("cloud.download.save.label", [providerDisplayName]));
    cloudDownloadSave.setAttribute("key", providerKey);

    if (providerIcon === CLOUD_PROVIDER_DEFAULT_ICON) {
      cloudDownloadSave.setAttribute("disabled", true);
    } else {
      cloudDownloadSave.removeAttribute("disabled");
    }

    document.getElementById("cloudDownloadCancel").setAttribute("label", "Not Now");
   //   this.getString("cloud.download.notNow.label"));

    // check if a user is signed in and set attribute show accordingly
 //   document.getElementById("syncSignInLink").setAttribute("value",
   //   this.getString("cloud.download.sync.signin"));

  //  document.getElementById("cloudDownloadSignInText").setAttribute("value",
   //   this.getString("cloud.download.sync.signin.text"));

  //  document.getElementById("cloudDownloadSyncText").setAttribute("value",
   //   this.getString("cloud.download.sync.signed.text"));

   /* if (CloudDownloadsView.gIsSyncUser) {
      document.getElementById("syncMessage").setAttribute("show", true);
      document.getElementById("syncSignIn").removeAttribute("show");
    } else {
      document.getElementById("syncSignIn").setAttribute("show", true);
      document.getElementById("syncMessage").removeAttribute("show");
    } */

    panelCloudNotification.setAttribute("show", "true");
    panelCloudNotification.addEventListener("click", this);
  },

  addRadioOption(key, providerName, document) {
    let option = document.createElement("radio");
    option.id = key;
    option.type = "radio";

    option.setAttribute("label", "Save to " + providerName);
     // this.getFormattedString("cloud.download.save.label", [providerName]));
    option.setAttribute("provider", this.formatProviderName(providerName));
    option.setAttribute("selected", false);
    return option;
  },

  handleMultipleProviders(providersMap, document) {
    let multiProviderSelect = document.getElementById("multiProviderSelect");

    let providers = [];
    providersMap.forEach((value, key) => {
      providers.push({"key": key, "name": value.displayName});
    });

    // Reset multiProviderSelect by removing any previous
    // added options
    while (multiProviderSelect.firstChild) {
      multiProviderSelect.firstChild.remove();
    }

    for (let provider of providers) {
      multiProviderSelect.appendChild(
        this.addRadioOption(provider.key, provider.name, document));
    }
    multiProviderSelect.setAttribute("show", "true");
  },

  handleEvent(event) {
    if (event.target.parentElement.id === "multiProviderSelect") {
      let cloudDownloadSave = event.currentTarget.children[1].children.cloudDownloadSave;
      cloudDownloadSave.setAttribute("label", event.target.label);
      cloudDownloadSave.setAttribute("key", event.target.id);
      cloudDownloadSave.removeAttribute("disabled");
      return;
    }
    switch (event.target.id) {
      case "cloudDownloadSave":
        CloudStorage.savePromptResponse(event.target.getAttribute("key"), true, true);
        event.currentTarget.removeAttribute("show");
        break;
      case "cloudDownloadCancel":
        // Set interval when notification was last shown
        Services.prefs.setIntPref(CLOUD_SERVICES_PREF + "lastprompt",
                          Math.floor(Date.now() / 1000));
        event.currentTarget.removeAttribute("show");
        break;
      case "cloudDownloadPreference":
        let origin = null;
        let entryPoint = "CloudStorage";
        RecentWindow.getMostRecentBrowserWindow().openPreferences("paneGeneral",
          {origin, urlParams: {entrypoint: entryPoint}});
        break;
    }
  },
};

XPCOMUtils.defineLazyGetter(CloudDownloadsView, "gCloudDownloadsBundle", function() {
  const kUrl = CloudDownloadsView.propertiesURL;
  return Services.strings.createBundle(kUrl);
});


XPCOMUtils.defineLazyPreferenceGetter(CloudDownloadsView, "gIsSyncUser",
  "services.sync.username", "");

/**
 * generic pref that shows if cloud storage API is in use, by default set to false.
 */
XPCOMUtils.defineLazyPreferenceGetter(CloudDownloadsView, "gIsAPIEnabled",
  CLOUD_SERVICES_PREF + "api.enabled", false, () => CloudDownloadsView.init());

CloudDownloadsView.promiseInit = CloudDownloadsView.init();

