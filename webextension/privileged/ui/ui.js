/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
/* global ExtensionAPI */

/**
 * Handles the Cloud Downloads UI in download panel.
 */

"use strict";
ChromeUtils.import("resource://gre/modules/Services.jsm");

this.ui = class extends ExtensionAPI {
  getAPI(context) {
    const { CloudDownloadsView } = ChromeUtils.import(
      context.extension.rootURI.resolve("privileged/ui/CloudDownloadsView.jsm")
    );

    return {
      ui: {
        async startup(path) {
          console.log(CloudDownloadsView);
          CloudDownloadsView.stylesURL = path;

          let isAPIEnabled = Services.prefs.getBoolPref("cloud.services.api.enabled", false);
          if (isAPIEnabled) {
            await CloudDownloadsView.init();
          } else {
             Services.prefs.setBoolPref("cloud.services.api.enabled", true);
          }
          return path;
        },
      }
    };
  }
};
