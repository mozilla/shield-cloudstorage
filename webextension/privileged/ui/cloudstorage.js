/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/* global ExtensionAPI */

/**
 * Handles the Cloud Downloads UI in download panel.
 */

"use strict";
ChromeUtils.import("resource://gre/modules/Services.jsm");
ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
ChromeUtils.import("resource://gre/modules/ExtensionUtils.jsm");

// eslint-disable-next-line no-undef
const { EventManager } = ExtensionCommon;
// eslint-disable-next-line no-undef
const { EventEmitter } = ExtensionUtils;

this.cloudstorage = class extends ExtensionAPI {
  getAPI(context) {
    const { CloudDownloadsView } = ChromeUtils.import(
      context.extension.rootURI.resolve("privileged/ui/CloudDownloadsView.jsm")
    );

    const cloudStorageEventEmitter = new EventEmitter();

    context.extension.callOnClose({
      close: () => {
        if (context.extension.shutdownReason === "ADDON_UNINSTALL" ||
           context.extension.shutdownReason === "ADDON_DISABLE") {
          Services.prefs.setBoolPref("cloud.services.api.enabled", false);
          // Ensure cloud storage study prefs are cleared
          for (let pref of ["lastprompt", "interval.prompt", "storage.key", "api.enabled"]) {
            Services.prefs.clearUserPref(`cloud.services.${pref}`);
          }
          // Unload the JS module
          Cu.unload(context.extension.rootURI.resolve("privileged/ui/CloudDownloadsView.jsm"));
        }
      },
    });

    return {
      cloudstorage: {
        async init(path, interval, variation) {
          CloudDownloadsView.stylesURL = path;
          CloudDownloadsView.studyVariation = variation;
          CloudDownloadsView.eventEmitter = cloudStorageEventEmitter;

          const isAPIEnabled = Services.prefs.getBoolPref("cloud.services.api.enabled", false);
          if (!isAPIEnabled) {
            // Set cloud.services.api.enabled pref to true on install and enabling the extension
            // Changing the prefs will initialize and trigger  toggleAPIEnabledState
            // because the CloudDownloadsView will observe the pref
            // Interval used to display notification at specified interval
            Services.prefs.setBoolPref("cloud.services.api.enabled", true);
            Services.prefs.setCharPref("cloud.services.interval.prompt", interval);
          }
          await CloudDownloadsView.toggleAPIEnabledState();
          return path;
        },

        uninit() {
          // Set API enabled false to uninitialize listeners in CloudDownloadsView
          Services.prefs.setBoolPref("cloud.services.api.enabled", false);
          // Ensure cloud storage study prefs are cleared
          for (let pref of ["lastprompt", "interval.prompt", "storage.key", "api.enabled"]) {
            Services.prefs.clearUserPref(`cloud.services.${pref}`);
          }
          // Unload the JS module
          Cu.unload(context.extension.rootURI.resolve("privileged/ui/CloudDownloadsView.jsm"));
        },

        onRecordTelemetry: new EventManager(
          context,
          "cloudStorage.onRecordTelemetry",
          fire => {
            const listener = (eventName, value) => {
              fire.async(value);
            };
            cloudStorageEventEmitter.on(
              "record-telemetry",
              listener,
            );
            return () => {
              cloudStorageEventEmitter.off(
                "record-telemetry",
                listener,
              );
            };
          },
        ).api(),
      }
    };
  }
};
