try {
  browser.cloudstorage.init(browser.runtime.getURL("./skin/clouddownloads.css")).then(
    result => {
      // Remove when background js is integrated with shield utils
      console.log(result); // eslint-disable-line no-console
    }
  );
} catch (e) {
  console.log(e); // eslint-disable-line no-console
}
