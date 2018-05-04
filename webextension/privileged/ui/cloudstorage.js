/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/* global ExtensionAPI */

/**
 * Handles the Cloud Downloads UI in download panel.
 */

"use strict";
ChromeUtils.import("resource://gre/modules/Services.jsm");

this.cloudstorage = class extends ExtensionAPI {
  getAPI(context) {
    const { CloudDownloadsView } = ChromeUtils.import(
      context.extension.rootURI.resolve("privileged/ui/CloudDownloadsView.jsm")
    );

    function cleanUpPrefs() {
      // Ensure cloud storage study prefs are cleared
      ["lastprompt", "interval.prompt", "storage.key", "api.enabled"].forEach(pref => {
        Services.prefs.clearUserPref(`cloud.services.${pref}`);
      });
    }

    context.extension.callOnClose({
      close: () => {
        if (context.extension.shutdownReason === "ADDON_UNINSTALL" ||
            context.extension.shutdownReason === "ADDON_DISABLE") {
          Services.prefs.setBoolPref("cloud.services.api.enabled", false);
          cleanUpPrefs();
        }
      },
    });

    return {
      cloudstorage: {
        async init(path) {
          CloudDownloadsView.stylesURL = path;

          const isAPIEnabled = Services.prefs.getBoolPref("cloud.services.api.enabled", false);
          if (isAPIEnabled) {
            await CloudDownloadsView.toggleAPIEnabledState();
          } else {
            // Set cloud.services.api.enabled pref to true on install and enabling the extension
            // Changing the prefs will initialize and trigger  toggleAPIEnabledState
            // because the CloudDownloadsView will observe the pref
            const interval = 0; // Interval to be picked from Study Utils Config
            Services.prefs.setBoolPref("cloud.services.api.enabled", true);
            Services.prefs.setCharPref("cloud.services.interval.prompt", interval);
          }
          return path;
        },
      }
    };
  }
};
