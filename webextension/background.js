try {
  browser.cloudstorage.init(browser.runtime.getURL("./skin/clouddownloads.css")).then(
    result => {
      console.log(result);
    }
  );

  function install() {
    console.log("Cloud Storage extension installed");
  }

  function uninstall() {
    console.log("Cloud Storage extension uninstalled");
  }

  browser.runtime.onInstalled.addListener(install);
  browser.management.onEnabled.addListener(install);
  browser.management.onDisabled.addListener(uninstall);
  browser.management.onUninstalled.addListener(uninstall);
} catch(e) {
  console.log(e);
}
