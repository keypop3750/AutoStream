'use strict';
const { normaliseQuality } = require('./quality');

function buildStreamTitle(metaName, season, episode, qualityLabel) {
  let title = metaName;
  if (season != null && episode != null) {
    const seasonStr = String(season).padStart(2, '0');
    const episodeStr = String(episode).padStart(2, '0');
    title += ' — S' + seasonStr + 'E' + episodeStr;
  }
  if (qualityLabel) title += ' – ' + qualityLabel;
  return title;
}

function formatStreams(metaInfo, selectedStreams, providerTag = null) {
  return selectedStreams.map((orig) => {
    let qualityLabel;
    if (orig.tag) qualityLabel = orig.tag;
    else if (orig.name) {
      const detail = orig.name.split('\n')[1] || '';
      qualityLabel = detail.split(/\s+/)[0];
    }
    const normalised = normaliseQuality(qualityLabel);
    const copy = Object.assign({}, orig);
    copy.name = providerTag ? ('AutoStream (' + providerTag + ')') : 'AutoStream';
    copy.title = buildStreamTitle(metaInfo.name, metaInfo.season, metaInfo.episode, normalised);
    return copy;
  });
}

module.exports = { buildStreamTitle, formatStreams };
