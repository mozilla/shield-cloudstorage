try {
  function handleStartup() {
  	console.log("startup called");
  	 browser.cloudstorage.init(browser.runtime.getURL("./skin/clouddownloads.css")).then(
	    result => {
	      console.log(result);
	    }
	  );
  }

  function handleInstalled() {
  	console.log("Installed called");
  	 browser.cloudstorage.init(browser.runtime.getURL("./skin/clouddownloads.css")).then(
	    result => {
	      console.log(result);
	    }
	  );
  }

  browser.runtime.onStartup.addListener(handleStartup);
  browser.runtime.onInstalled.addListener(handleInstalled);
} catch(e) {
  console.log(e);
}
