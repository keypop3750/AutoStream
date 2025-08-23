'use strict';
// Wrap the original pickStreams to make it language-first without touching core logic.

const score = require('./score');
const { sortByLanguagePreference } = require('./filters');

function pickStreamsLangFirst(streams, useDebrid, include1080, log, opts) {
  try {
    const prefs = (opts && Array.isArray(opts.langPrio) && opts.langPrio.length)
      ? opts.langPrio
      : ['EN'];

    const inArr = Array.isArray(streams) ? streams.slice() : [];
    // Pre-order by language so the original sorter starts from the preferred pool/order
    const preordered = sortByLanguagePreference(inArr, prefs);

    // Call the original function
    const out = score.pickStreams(preordered, useDebrid, include1080, log);

    // Re-apply language ordering to the final set (stable), just in case
    return sortByLanguagePreference(Array.isArray(out) ? out.slice() : [], prefs);
  } catch (e) {
    // Fallback to original behavior on any unexpected error
    return score.pickStreams(streams, useDebrid, include1080, log);
  }
}

// Re-export everything from the original score module, but override pickStreams
module.exports = Object.assign({}, score, { pickStreams: pickStreamsLangFirst });
