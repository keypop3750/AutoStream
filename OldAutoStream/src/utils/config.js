'use strict';
// Recognize all supported debrid params (opt-in).
// Used by server.js to detect whether "debrid mode" is active.
function providerTagFromParams(params) {
  if (params && params.get('ad')) return 'AD';
  if (params && params.get('rd')) return 'RD';
  if (params && params.get('pm')) return 'PM';
  if (params && params.get('tb')) return 'TB'; // TorBox
  if (params && params.get('oc')) return 'OC'; // Offcloud
  return null;
}

function hasDebrid(params) {
  const keys = ['ad','rd','pm','tb','oc'];
  return !!params && keys.some((k) => params.has(k) && params.get(k));
}

module.exports = { providerTagFromParams, hasDebrid };
