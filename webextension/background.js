try {
	browser.ui.setStylesURL(browser.runtime.getURL("./skin/clouddownloads.css")).then(
	  result => {
	    console.log(result);
	  }
	);
	browser.ui.init().then(
	  result => {
	    console.log(result);
	  }
	);
} catch(e) {
	console.log(e);
}