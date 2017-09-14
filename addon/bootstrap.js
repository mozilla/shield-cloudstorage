"use strict";

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "(startup|shutdown|install|uninstall)" }]*/

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Console.jsm");
Cu.import("resource://gre/modules/Log.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "config",
  "chrome://cloud/content/Config.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "CloudStorageView",
  "chrome://cloud/content/CloudStorageView.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "studyUtils",
  "chrome://cloud/content/StudyUtils.jsm");

var log = {};
var WindowListener = {
  setupBrowserUI: function wm_setupBrowserUI(window) {
    let utils = window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
    utils.loadSheetUsingURIString("chrome://cloud/content/binding.css", Ci.nsIDOMWindowUtils.AGENT_SHEET);
  },

  tearDownBrowserUI: function wm_tearDownBrowserUI(window) {
    let utils = window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
    utils.removeSheetUsingURIString("chrome://cloud/content/binding.css", Ci.nsIDOMWindowUtils.AGENT_SHEET);
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
  log = createLog(config.study.studyName, config.log.bootstrap.level);  // defined below.
  log.debug("startup", REASONS[reason] || reason);

  studyUtils.setup({
    studyName: config.study.studyName,
    endings: config.study.endings,
    addon: {id: addonData.id, version: addonData.version},
    telemetry: config.study.telemetry,
  });
  studyUtils.setLoggingLevel(config.log.studyUtils.level);
  const variation = await chooseVariation();
  studyUtils.setVariation(variation);
  Jsm.import(config.modules);

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

  console.log(`info ${JSON.stringify(studyUtils.info())}`);


  let wm = Cc["@mozilla.org/appshell/window-mediator;1"].
           getService(Ci.nsIWindowMediator);

  // Get the list of browser windows already open
  let windows = wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    WindowListener.setupBrowserUI(domWindow);
  }

  // Wait for any new browser windows to open
  Services.wm.addListener(WindowListener);

  Services.obs.addObserver(observe, "cloudstorage-prompt-notification");
  let properties = initTreatments();
  await CloudStorageView.init(studyUtils, properties);
}

function shutdown(addonData, reason) {
  let wm = Cc["@mozilla.org/appshell/window-mediator;1"].
           getService(Ci.nsIWindowMediator);

  // Get the list of browser windows already open
  let windows = wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);

    WindowListener.tearDownBrowserUI(domWindow);
  }
  // Stop listening for any new browser windows to open
  wm.removeListener(WindowListener);
  Services.obs.removeObserver(observe, "cloudstorage-prompt-notification");

  console.log("shutdown", REASONS[reason] || reason);
  // are we uninstalling?
  // if so, user or automatic?
  if (reason === REASONS.ADDON_UNINSTALL || reason === REASONS.ADDON_DISABLE) {
    console.log("uninstall or disable");
    if (!studyUtils._isEnding) {
      // we are the first requestors, must be user action.
      console.log("user requested shutdown");
      studyUtils.endStudy({reason: "user-disable"});
    }
  }

  console.log("Jsms unloading");
  Jsm.unload(config.modules);
}

async function observe(subject, topic, data) {
  // TBD: Check for variation here before handling
  // notification
  switch (topic) {
    case "cloudstorage-prompt-notification":
      console.log("notification receivced:", data);
      await studyUtils.telemetry({ message: "download_started" });
      await CloudStorageView.handlePromptNotification(data);
      break;
  }
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
  var L = Log.repository.getLogger(name);
  L.addAppender(new Log.ConsoleAppender(new Log.BasicFormatter()));
  L.level = Log.Level[levelWord] || Log.Level.Debug; // should be a config / pref
  return L;
}

async function chooseVariation() {
  let toSet, source;
  const sample = studyUtils.sample;
  const studyConfig = config.study;

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

function initTreatments() {
  let treatment = studyUtils.getVariation().name;
  let propertiesURL = "chrome://cloud/locale/storage.properties";
  console.log("initTreatments:", treatment);

  let interval = 0; // 0 days
  switch (treatment) {
    case "promptInterval_None_Content_Default":
      propertiesURL = "chrome://cloud/locale/storage.properties";
      break;
    case "promptInterval_None_Content_A":
      propertiesURL = "chrome://cloud/locale/storage-var-a.properties";
      break;
    case "promptInterval_Content_Default":
      interval = config.study.promptInterval;
      propertiesURL = "chrome://cloud/locale/storage.properties";
      break;
    case "promptInterval_Content_A":
      interval = config.study.promptInterval;
      propertiesURL = "chrome://cloud/locale/storage-var-a.properties";
      break;
  }

  Services.prefs.setCharPref("cloud.services.interval.prompt", interval);
  return propertiesURL;
}

// jsm loader / unloader
class Jsm {
  static import(modulesArray) {
    for (const module of modulesArray) {
      log.debug(`loading ${module}`);
      Cu.import(module);
    }
  }
  static unload(modulesArray) {
    for (const module of modulesArray) {
      log.debug(`Unloading ${module}`);
      Cu.unload(module);
    }
  }
}
