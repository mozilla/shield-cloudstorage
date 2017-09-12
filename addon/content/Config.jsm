/* to use:

- Recall this file has chrome privileges
- Cu.import in this file will work for any 'general firefox things' (Services,etc)
  but NOT for addon-specific libs
*/

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "(config|EXPORTED_SYMBOLS)" }]*/
var EXPORTED_SYMBOLS = ["config"];

var config = {
  "study": {
    "studyName": "cloud-storage-study", // no spaces, for all the reasons
    "weightedVariations": [
      { name: "control", "weight": 1 },
      { name: "promptInterval_None_Content_Default", "weight": 1 },
      { name: "promptInterval_None_Content_A", "weight": 1 },
      { name: "promptInterval_Content_Default", "weight": 1 },
      { name: "promptInterval_Content_A", "weight": 1 },
    ],
    /** **endings**
      * - keys indicate the 'endStudy' even that opens these.
      * - urls should be static (data) or external, because they have to
      *   survive uninstall
      * - If there is no key for an endStudy reason, no url will open.
      * - usually surveys, orientations, explanations
      */
    "endings": {},
    "telemetry": {
      "send": true, // assumed false. Actually send pings?
      "removeTestingFlag": false,  // Marks pings as testing, set true for actual release
      // TODO "onInvalid": "throw"  // invalid packet for schema?  throw||log
    },
    "studyUtilsPath": `./StudyUtils.jsm`,
    "promptInterval": 0.0001, // in days (~ 2 mins) 
  },
  "isEligible": async function() {
    // get whatever prefs, addons, telemetry, anything!
    // Cu.import can see 'firefox things', but not package things.
    return true;
  },
  // addon-specific modules to load/unload during `startup`, `shutdown`
  "modules": [
    // can use ${slug} here for example
  ],
  // sets the logging for BOTH the bootstrap file AND shield-study-utils
  "log": {
    // Fatal: 70, Error: 60, Warn: 50, Info: 40, Config: 30, Debug: 20, Trace: 10, All: -1,
    "bootstrap":  {
      "level": "Debug",
    },
    "studyUtils":  {
      "level": "Trace",
    },
  },
};
