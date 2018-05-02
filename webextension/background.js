/* global getStudySetup */

/**
 *  Goal:  Implement an instrumented feature using
 *  `browser.study` API
 *
 *  Every runtime:
 *  - instantiate the feature
 *
 *    - listen for `onEndStudy` (study endings)
 *    - listen for `study.onReady`
 *    - attempt to `browser.study.setup` the study using our studySetup
 *
 *      - will fire EITHER endStudy (expired, ineligible)
 *      - onReady
 *      - (see docs for `browser.study.setup`)
 *
 *    - onReady: configure the feature to match the `variation` study selected
 *    - or, if we got an `onEndStudy` cleanup and uninstall.
 *
 *    During the feature:
 *    - `sendTelemetry` to send pings
 *    - `endStudy` to force an ending (for positive or negative reasons!)
 *
 *  Interesting things to try next:
 *  - `browser.study.validateJSON` your pings before sending
 *  - `endStudy` different endings in response to user action
 *  - force an override of timestamp to see an `expired`
 *  - unset the shield or telemetry prefs during runtime to trigger an ending.
 *
 */

class StudyLifeCycleHandler {
  /**
   * Listen to onEndStudy, onReady
   * `browser.study.setup` fires onReady OR onEndStudy
   *
   * call `this.enableFeature` to actually do the feature/experience/ui.
   */
  constructor() {
    browser.study.onEndStudy.addListener(this.handleStudyEnding);
    browser.study.onReady.addListener(this.enableFeature);
  }

  /**
   * do some cleanup / 'feature reset'
   *
   * (If you have privileged code, you might need to clean
   *  that up as well.
   * See:  https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/lifecycle.html
   */
  async cleanup() {
    await browser.storage.local.clear();
  }

  /**
   * - set up expiration alarms
   * - make feature/experience/ui with the particular variation for this user.
   */
  async enableFeature(studyInfo) {
    if (studyInfo.timeUntilExpire) {
      browser.alarms.create(studyInfo.timeUntilExpire, () =>
        browser.study.endStudy("expired"),
      );
    }
    // browser.browserAction.setTitle({ title: studyInfo.variation.name });
    console.log(// eslint-disable-line no-console
      `Changed the browser action title to the variation name: ${
        studyInfo.variation.name
      }`,
    );

    try {
      let interval = 0;
      const treatment = studyInfo.variation.name;
      switch (treatment) {
      case "notification-interval-short":
        // When dismissed shows next
        // prompt after promptInterval (specified in days)
        // Update to pick from studyInfo once studyInfo has
        // studySetup object available (WIP)
        interval = 1;
        break;
      case "notification-interval-longer":
        interval = 2;
        break;
      }

      browser.cloudstorage.init(browser.runtime.getURL("./skin/clouddownloads.css"), interval).then(
        result => {
        // Remove when background js is integrated with shield utils
          console.log(result); // eslint-disable-line no-console
        });
    } catch (e) {
      console.log(e); // eslint-disable-line no-console
    }
  }

  /** handles `study:end` signals
   *
   * - opens 'ending' urls (surveys, for example)
   * - calls cleanup
   */
  async handleStudyEnding(ending) {
    console.log("study wants to end:", ending); // eslint-disable-line no-console
    ending.urls.forEach(async url => await browser.tabs.create({ url }));
    switch (ending.reason) {
    default:
      this.cleanup();
      // uninstall the addon?
      break;
    }
  }
}

/**
 * Run every startup to get config and instantiate the feature
 */
async function onEveryExtensionLoad() {
  new StudyLifeCycleHandler();
  const studySetup = await getStudySetup();
  await browser.study.setup(studySetup);
}
onEveryExtensionLoad();
