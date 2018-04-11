try {
  browser.ui.startup(browser.runtime.getURL("./skin/clouddownloads.css")).then(
	  result => {
	    console.log(result);
	  }
	);
} catch(e) {
	console.log(e);
}