try {
	// TBD: combine as startup method
	browser.ui.setStylesURL(browser.runtime.getURL("./skin/clouddownloads.css")).then(
	  result => {
	    console.log(result);
	  }
	);

	browser.ui.setCloudStoragePref(true).then(
	  result => {
	    console.log(result);
	  }
	);
} catch(e) {
	console.log(e);
}