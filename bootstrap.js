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

const BUGZILLA_API_URL = "https://bugzilla.mozilla.org/rest/";
const BUGZILLA_BUG_URL = "https://bugzil.la/";
const PREFS = "extensions.hubzilla.";
const PREFS_LOGIN = PREFS + "login";

function optionsCallback() {
  return {
    title: Strings.GetStringFromName("panel-title"),
    views: [{
      type: Home.panels.View.LIST,
      dataset: DATASET_ID
    }]
  };
}

// An XHR request to fetch data for panel.
function fetchData(url) {
  let deferred = Promise.defer();
  let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
  try {
    xhr.mozBackgroundRequest = true;
    xhr.open("GET", url, true);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.overrideMimeType("application/json");
    xhr.responseType = "json";
    xhr.onerror = function onerror(e) {
      deferred.reject(e);
    };
    xhr.onload = function onload(event) {
      if (xhr.status === 200) {
        deferred.resolve(xhr.response);
      } else {
        deferred.reject(xhr.status);
      }
    };
    xhr.send(null);
  } catch (e) {
    deferred.reject(e);
  }
  return deferred.promise;
}

function refreshDataset() {
  let login = Services.prefs.getCharPref(PREFS_LOGIN);
  if (!login) {
    return;
  }
  Task.spawn(function() {
    let storage = HomeProvider.getStorage(DATASET_ID);
    yield storage.deleteAll();

    let assigned = yield fetchData(BUGZILLA_API_URL +
        "bug?assigned_to=" + encodeURIComponent(login) +
        "&limit=50&include_fields=id,summary");
    if (!assigned) {
      return;
    }

    yield storage.save(assigned.bugs.map(bug => ({
      url: BUGZILLA_BUG_URL + bug.id,
      title: Strings.formatStringFromName("assigned-title", [bug.id + ""], 1),
      description: bug.summary,
    })));
  }).then(null, e => Cu.reportError("Error refreshing dataset " + DATASET_ID + ": " + e));
}

function deleteDataset() {
  Task.spawn(function() {
    let storage = HomeProvider.getStorage(DATASET_ID);
    yield storage.deleteAll();
  }).then(null, e => Cu.reportError("Error deleting data from HomeProvider: " + e));
}

const PrefsObserver = {
  observe: function(aSubject, aTopic, aData) {
    if (aTopic === "addon-options-hidden" && aData === PANEL_ID) {
      HomeProvider.requestSync(DATASET_ID, refreshDataset);
    }
  }
};

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

  Services.obs.addObserver(PrefsObserver, "addon-options-hidden", false);
}

function shutdown(data, reason) {
  if (reason == ADDON_UNINSTALL || reason == ADDON_DISABLE) {
    Home.panels.uninstall(PANEL_ID);
    deleteDataset();
  }

  // Always unregister your panel on shutdown.
  Home.panels.unregister(PANEL_ID);

  HomeProvider.removePeriodicSync(DATASET_ID);

  Services.obs.removeObserver(PrefsObserver, "addon-options-hidden");
}

function install(data, reason) {}

function uninstall(data, reason) {}
