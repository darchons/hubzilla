const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Home.jsm");
Cu.import("resource://gre/modules/HomeProvider.jsm");
Cu.import("resource://gre/modules/Promise.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// Make these IDs unique, preferably tied to a domain that you own.
const PANEL_ID = "hubzilla@jnchen.com";
const DATASET_ID = "hub@bugzilla.mozilla.org";

// An example of how to create a string bundle for localization.
XPCOMUtils.defineLazyGetter(this, "Strings", function() {
  return Services.strings.createBundle("chrome://hubzilla/locale/hubzilla.properties");
});

const BUGZILLA_API_URL = "https://bugzilla.mozilla.org/jsonrpc.cgi";
const BUGZILLA_BUG_URL = "https://bugzil.la/";
const IMG_ALERT_URL = "https://bugzilla.mozilla.org/" +
                      "skins/contrib/Mozilla/bugzilla-questionmark2.png";
const IMG_ERROR_URL = "https://bugzilla.mozilla.org/" +
                      "skins/contrib/Mozilla/bugzilla-person-alternate.png";

function optionsCallback() {
  return {
    title: Strings.GetStringFromName("panel-title"),
    views: [{
      type: Home.panels.View.LIST,
      dataset: DATASET_ID
    }]
  };
}

let seqno = 0;

// An XHR request to fetch data for panel.
function fetchData(request) {
  let deferred = Promise.defer();
  let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
  try {
    xhr.mozBackgroundRequest = true;
    xhr.open("POST", BUGZILLA_API_URL, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.overrideMimeType("application/json");
    xhr.responseType = "json";
    xhr.onerror = function(e) {
      deferred.reject(e);
    };
    xhr.onload = function() {
      if (xhr.response && xhr.response.result) {
        deferred.resolve(xhr.response.result);
      } else if (xhr.response && xhr.response.error) {
        deferred.reject(xhr.response.error);
      } else {
        deferred.reject("Request status " + xhr.status);
      }
    };
    request.version = "1.0";
    request.id = ++seqno;
    xhr.send(JSON.stringify(request));
  } catch (e) {
    deferred.reject(e);
  }
  return deferred.promise;
}

function refreshDataset() {
  let storage = HomeProvider.getStorage(DATASET_ID);
  Task.spawn(function() {
    let requestee = yield fetchData({
        method: "MyDashboard.run_flag_query",
        params: { type: "requestee" }
    });

    yield storage.deleteAll();

    yield storage.save(requestee.result.requestee.map(request => ({
      url: BUGZILLA_BUG_URL + request.bug_id,
      title: Strings.formatStringFromName("requestee-title",
        [request.type + request.status, request.requester], 2),
      description: Strings.formatStringFromName("requestee-desc",
        [request.bug_id + "", request.bug_summary], 2),
      image_url: IMG_ALERT_URL,
    })));

    let assigned = yield fetchData({
        method: "MyDashboard.run_bug_query",
        params: { query: "assignedbugs" }
    });

    yield storage.save(assigned.result.bugs.map(bug => ({
      url: BUGZILLA_BUG_URL + bug.bug_id,
      title: Strings.formatStringFromName("bug-title",
        [bug.bug_id + "", bug.bug_status], 2),
      description: bug.short_desc,
    })));

  }).then(null, e => {
    Cu.reportError("Error refreshing dataset " + DATASET_ID + ": " + e);

    if (!e.name || !e.message) {
      return;
    }

    return storage.save([{
      url: BUGZILLA_BUG_URL,
      title: e.name,
      description: e.message,
      image_url: IMG_ERROR_URL,
    }]);
  });
}

function deleteDataset() {
  Task.spawn(function() {
    let storage = HomeProvider.getStorage(DATASET_ID);
    yield storage.deleteAll();
  }).then(null, e => Cu.reportError("Error deleting data from HomeProvider: " + e));
}

/**
 * bootstrap.js API
 * https://developer.mozilla.org/en-US/Add-ons/Bootstrapped_extensions
 */
function startup(data, reason) {
  // Always register your panel on startup.
  Home.panels.register(PANEL_ID, optionsCallback);

  switch(reason) {
    case ADDON_INSTALL:
    case ADDON_ENABLE:
      Home.panels.install(PANEL_ID);
      HomeProvider.requestSync(DATASET_ID, refreshDataset);
      break;

    case ADDON_UPGRADE:
    case ADDON_DOWNGRADE:
      Home.panels.update(PANEL_ID);
      break;
  }

  // Update data once every hour.
  HomeProvider.addPeriodicSync(DATASET_ID, 3600, refreshDataset);
}

function shutdown(data, reason) {
  if (reason == ADDON_UNINSTALL || reason == ADDON_DISABLE) {
    Home.panels.uninstall(PANEL_ID);
    deleteDataset();
  }

  // Always unregister your panel on shutdown.
  Home.panels.unregister(PANEL_ID);

  HomeProvider.removePeriodicSync(DATASET_ID);
}

function install(data, reason) {}

function uninstall(data, reason) {}
