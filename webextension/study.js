/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "getStudySetup" }]*/

/**
 *  Overview:
 *
 *  - constructs a well-formatted `studySetup` for use by `browser.study.setup`
 *  - mostly declarative, except that some fields are set at runtime
 *    asynchronously.
 *
 *  Advanced features:
 *  - testing overrides from preferences
 *  - expiration time
 *  - some user defined endings.
 *  - study defined 'shouldAllowEnroll' logic.
 */

/** Base for studySetup, as used by `browser.study.setup`.
 *
 * Will be augmented by 'getStudySetup'
 */
const baseStudySetup = {
  // used for activeExperiments tagging (telemetryEnvironment.setActiveExperiment)
  activeExperimentName: browser.runtime.id,

  // uses shield|pioneer pipeline, watches those permissions
  studyType: "shield",

  // telemetry
  telemetry: {
    send: true, // assumed false. Actually send pings?
    removeTestingFlag: false, // Marks pings as testing, set true for actual release
  },

  // endings with urls
  endings: {
    /** standard endings */
    "user-disable": {
      baseUrl: "https://www.surveygizmo.com/s3/4361888/Cloud-Storage-Phase-2-Post-Survey",
    },
    expired: {
      baseUrl: "https://www.surveygizmo.com/s3/4361888/Cloud-Storage-Phase-2-Post-Survey",
    },
  },

  // Interval in day(s) used by variations
  interval: {
    shortDuration: 1,
    longDuration: 2
  },

  variationOverridePreference: "cloud.services.shield.variation",

  // Study branches and sample weights, overweighing feature branches
  weightedVariations: [
    {
      name: "notification-interval-short",
      weight: 1.5,
    },
    {
      name: "notification-interval-longer",
      weight: 1.5,
    },
    {
      name: "control",
      weight: 1,
    },
  ],

  // maximum time that the study should run, from the first run
  expire: {
    days: 14,
  },

  // Optional: testing overrides.
  // Set from prefs in getStudySetup
  testing: {
    variation: null,
    firstRunTimestamp: null,
  },
};

/**
 * Determine, based on common and study-specific criteria, if enroll (first run)
 * should proceed.
 *
 * False values imply that during first run, we should endStudy(`ineligible`)
 *
 * Add your own enrollment criteria as you see fit.
 *
 * (Guards against Normandy or other deployment mistakes or inadequacies)
 *
 * This implementation caches in local storage to speed up second run.
 *
 * @returns boolean answer about whether the user should be
 *       allowed to enroll in the study
 */
function shouldAllowEnroll() {
  return true;
}

/**
 * Augment declarative studySetup with any necessary async values
 *
 * @return {object} studySetup A complete study setup object
 */
function getStudySetup() {
  const studySetup = Object.assign({}, baseStudySetup);

  studySetup.allowEnroll = shouldAllowEnroll();
  studySetup.testing = {
    /* Example: override testing keys various ways, such as by prefs. (TODO) */
    variation: null, // await browser.prefs.getStringPref(prefs.variation);
    firstRunTimestamp: null, // await browser.prefs.getStringPref(prefs.firstRunTimestamp);
  };
  return studySetup;
}
