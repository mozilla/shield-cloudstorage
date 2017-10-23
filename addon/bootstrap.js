"use strict";


/* global  __SCRIPT_URI_SPEC__  */
/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "(startup|shutdown|install|uninstall)" }]*/

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "CloudStorageView",
  "chrome://cloud/content/CloudStorageView.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Services",
  "resource://gre/modules/Services.jsm");

/* Shield */
const CONFIGPATH = `${__SCRIPT_URI_SPEC__}/../Config.jsm`;
const { config } = Cu.import(CONFIGPATH, {});
const studyConfig = config.study;
const log = createLog(studyConfig.studyName, config.log.bootstrap.level);  // defined below.

const STUDYUTILSPATH = `${__SCRIPT_URI_SPEC__}/../${studyConfig.studyUtilsPath}`;
const { studyUtils } = Cu.import(STUDYUTILSPATH, {});

var WindowListener = {
  setupBrowserUI: function wm_setupBrowserUI(window) {
    let utils = window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
    utils.loadSheetUsingURIString("chrome://cloud-shared/skin/cloudstorage.css", Ci.nsIDOMWindowUtils.AGENT_SHEET);
  },

  tearDownBrowserUI: function wm_tearDownBrowserUI(window) {
    let utils = window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
    utils.removeSheetUsingURIString("chrome://cloud-shared/skin/cloudstorage.css", Ci.nsIDOMWindowUtils.AGENT_SHEET);
  },

  // nsIWindowMediatorListener functions
  onOpenWindow: function wm_onOpenWindow(xulWindow) {
    // A new window has opened
    let domWindow = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                             .getInterface(Ci.nsIDOMWindow);

    // Wait for it to finish loading
    domWindow.addEventListener("load", function listener() {
      // If this is a browser window or places library window then setup its UI
      if (domWindow.document.documentElement.getAttribute("windowtype") == "navigator:browser" ||
          domWindow.document.documentElement.getAttribute("windowtype") == "Places:Organizer" ) {
        WindowListener.setupBrowserUI(domWindow);
      }
    }, {once: true});
  },
};

function install() {}
function uninstall() {}

async function startup(addonData, reason) {
  // addonData: Array [ "id", "version", "installPath", "resourceURI", "instanceID", "webExtension" ]  bootstrap.js:48
  log.debug("startup", REASONS[reason] || reason);

  studyUtils.setup({
    study: {
      studyName: studyConfig.studyName,
      endings: studyConfig.endings,
      telemetry: studyConfig.telemetry,
    },
    log: config.log,
    addon: {id: addonData.id, version: addonData.version},
  });
  studyUtils.setLoggingLevel(config.log.studyUtils.level);
  const variation = await chooseVariation();
  studyUtils.setVariation(variation);

  // Always set cloud.services.shieldstudy.expire pref if it's not set.
  // This is needed till opt-out expiration is supported in StudyUtils
  if (!Services.prefs.getCharPref(studyConfig.studyExpiredPref, "")) {
    const today = new Date();
    const expireDate = new Date(today.setDate(today.getDate() + studyConfig.studyDuration)).toString();
    Services.prefs.setCharPref(studyConfig.studyExpiredPref, expireDate);
  }

  if ((REASONS[reason]) === "ADDON_INSTALL") {
    studyUtils.firstSeen();  // sends telemetry "enter"
    const eligible = await config.isEligible(); // addon-specific
    if (!eligible) {
      // uses config.endings.ineligible.url if any,
      // sends UT for "ineligible"
      // then uninstalls addon
      await studyUtils.endStudy({reason: "ineligible"});
      return;
    }
  }
  await studyUtils.startup({reason});

  const expirationDate = new Date(Services.prefs.getCharPref(studyConfig.studyExpiredPref, ""));
  if (new Date() > expirationDate) {
    await studyUtils.endStudy({ reason: "expired" });
    return;
  }

  log.debug(`info ${JSON.stringify(studyUtils.info())}`);

  // Continue initializing cloud storage add-on for
  // branches other than "control"
  // "control" group is users with default setup and no UI changes.
  if (studyUtils.getVariation().name !== "control") {
    initialize();
  }
}

async function shutdown(addonData, reason) {
  // Uninitialize cloud storage add-on specific observers
  if (studyUtils.getVariation().name !== "control") {
    uninitialize();
  }
  log.debug("shutdown", REASONS[reason] || reason);
  // are we uninstalling?
  // if so, user or automatic?
  if (reason === REASONS.ADDON_UNINSTALL || reason === REASONS.ADDON_DISABLE) {
    log.debug("uninstall or disable");
    await cleanUpPrefs();
    if (!studyUtils._isEnding) {
      // we are the first requestors, must be user action.
      log.debug("user requested shutdown");
      studyUtils.endStudy({reason: "user-disable"});
    }
  }
}

function initialize() {
  // Get the list of browser windows already open
  let windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    WindowListener.setupBrowserUI(domWindow);
  }

  // Wait for any new browser windows to open
  Services.wm.addListener(WindowListener);

  // Add DownloadPrefObserver if user has previously opted-in for cloud storage downloads
  if (Services.prefs.getCharPref("cloud.services.storage.key", "")) {
    Services.prefs.addObserver("browser.download.folderList", CloudStorageView.downloadPrefObserve);
    Services.prefs.addObserver("browser.download.useDownloadDir", CloudStorageView.downloadPrefObserve);
  }

  Services.obs.addObserver(observe, "cloudstorage-prompt-notification");
  initTreatments();
}

async function observe(subject, topic, data) {
  switch (topic) {
    case "cloudstorage-prompt-notification":
      await studyUtils.telemetry({ message: "download_started" });
      await CloudStorageView.handlePromptNotification(data);
      break;
  }
}

async function initTreatments() {
  let treatment = studyUtils.getVariation().name;
  let propertiesURL = "chrome://cloud/locale/storage.properties";
  let isCloseHidden = true;
  let isNotificationPersistent = false;
  let notificationTransientTime = null;
  let interval = 0; // 0 days

  switch (treatment) {
    case "prompt_persistent":
      // Fully persistent prompt, can be removed after explicitly
      // closing the prompt or when user accepts or rejects the request
      isNotificationPersistent = true;
      break;
    case "prompt_not_persistent":
      // Non persistent prompt, disappear on click outside
      break;
    case "prompt_transient":
      // Transient prompt, removes itself after promptTransientTime
      isNotificationPersistent = true;
      notificationTransientTime = studyConfig.promptTransientTime;
      break;
    case "prompt_persistent_with_interval":
      // Treatment uses persistent prompt. When dismissed shows next
      // prompt after promptInterval (specified in days inside config.jsm)
      interval = studyConfig.promptInterval;
      isNotificationPersistent = true;
      break;
    case "prompt_not_persistent_with_interval":
      // Treatment uses non-persistent prompt. When dismissed shows next
      // prompt after promptInterval (specified in days)
      interval = studyConfig.promptInterval;
      break;
    case "prompt_transient_with_interval":
      // Treatment uses transient prompt. When dismissed shows next
      // prompt after promptInterval (specified in days)
      interval = studyConfig.promptInterval;
      isNotificationPersistent = true;
      notificationTransientTime = studyConfig.promptTransientTime;
      break;
    case "prompt_persistent_close_button":
      // Fully persistent prompt, can be removed after explicitly
      // closing the prompt or when user accepts or rejects the request
      // Shows 'x' close button of prompt
      isNotificationPersistent = true;
      isCloseHidden = false;
      break;
    case "prompt_persistent_with_interval_close_button":
      // Treatment uses persistent prompt. When dismissed shows next
      // prompt after promptInterval (specified in days inside config.jsm)
      // Shows 'x' close button of prompt
      interval = studyConfig.promptInterval;
      isNotificationPersistent = true;
      isCloseHidden = false;
      break;
  }
  Services.prefs.setBoolPref("cloud.services.api.enabled", true);
  Services.prefs.setCharPref("cloud.services.interval.prompt", interval);
  await CloudStorageView.init(studyUtils, propertiesURL, isCloseHidden,
                              isNotificationPersistent, notificationTransientTime);
}

function uninitialize() {
  // Get the list of browser windows already open
  let windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);

    WindowListener.tearDownBrowserUI(domWindow);
  }
  // Stop listening for any new browser windows to open
  Services.wm.removeListener(WindowListener);

  Services.prefs.removeObserver("browser.download.folderList", CloudStorageView.downloadPrefObserve);
  Services.prefs.removeObserver("browser.download.useDownloadDir", CloudStorageView.downloadPrefObserve);
  Services.obs.removeObserver(observe, "cloudstorage-prompt-notification");
}

async function cleanUpPrefs() {
  // Ensure cloud storage study related prefs are cleared
  const CLOUD_SERVICES_PREF = "cloud.services.";
  Services.prefs.clearUserPref(CLOUD_SERVICES_PREF + "lastprompt");
  Services.prefs.clearUserPref(CLOUD_SERVICES_PREF + "interval.prompt");
  Services.prefs.clearUserPref(CLOUD_SERVICES_PREF + "rejected.key");
  Services.prefs.clearUserPref(CLOUD_SERVICES_PREF + "shieldstudy.expire");

  // Check if user downloads preferences are set to provider download folder,
  // if yes we should let user keep using provider download folder
  // and log it in telemetry
  if (Services.prefs.getCharPref("cloud.services.storage.key", "")) {
    await studyUtils.telemetry({ message: "cloud_storage_opted_in" });
    return;
  }

  Services.prefs.clearUserPref(CLOUD_SERVICES_PREF + "storage.key");
  Services.prefs.clearUserPref(CLOUD_SERVICES_PREF + "api.enabled");
}

/** CONSTANTS and other bootstrap.js utilities */

// addon state change reasons
const REASONS = {
  APP_STARTUP: 1,      // The application is starting up.
  APP_SHUTDOWN: 2,     // The application is shutting down.
  ADDON_ENABLE: 3,     // The add-on is being enabled.
  ADDON_DISABLE: 4,    // The add-on is being disabled. (Also sent during uninstallation)
  ADDON_INSTALL: 5,    // The add-on is being installed.
  ADDON_UNINSTALL: 6,  // The add-on is being uninstalled.
  ADDON_UPGRADE: 7,    // The add-on is being upgraded.
  ADDON_DOWNGRADE: 8,  // The add-on is being downgraded.
};
for (const r in REASONS) { REASONS[REASONS[r]] = r; }

// logging
function createLog(name, levelWord) {
  Cu.import("resource://gre/modules/Log.jsm");
  var L = Log.repository.getLogger(name);
  L.addAppender(new Log.ConsoleAppender(new Log.BasicFormatter()));
  L.level = Log.Level[levelWord] || Log.Level.Debug; // should be a config / pref
  return L;
}

async function chooseVariation() {
  let toSet, source;
  const sample = studyUtils.sample;
  if (studyConfig.variation) {
    source = "startup-config";
    toSet = studyConfig.variation;
  } else {
    source = "weightedVariation";
    // this is the standard arm choosing method
    const clientId = await studyUtils.getTelemetryId();
    const hashFraction = await sample.hashFraction(studyConfig.studyName + clientId, 12);
    toSet = sample.chooseWeighted(studyConfig.weightedVariations, hashFraction);
  }
  log.debug(`variation: ${toSet} source:${source}`);
  return toSet;
}
