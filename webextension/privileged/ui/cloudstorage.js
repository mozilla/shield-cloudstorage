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

    return {
      cloudstorage: {
        async init(path) {
          console.log(CloudDownloadsView);
          CloudDownloadsView.stylesURL = path;

          let isAPIEnabled = Services.prefs.getBoolPref("cloud.services.api.enabled", false);
          if (isAPIEnabled) {
            await CloudDownloadsView.init();
          } else {
            let interval = 0; // TBD: Interval to be picked from Study Utils Config
            Services.prefs.setBoolPref("cloud.services.api.enabled", true);
            Services.prefs.setCharPref("cloud.services.interval.prompt", interval);
          }
          return path;
        },

        async uninit() {
          Services.prefs.setBoolPref("cloud.services.api.enabled", false);
        },
      }
    };
  }
};
