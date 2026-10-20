// Screenshot-only stand-in for the phone's secure vault in a browser (web builds have no vault). Never shipped.
module.exports = {
  getItemAsync: async k => window.localStorage.getItem(k),
  setItemAsync: async (k, v) => window.localStorage.setItem(k, v),
  deleteItemAsync: async k => window.localStorage.removeItem(k),
};
