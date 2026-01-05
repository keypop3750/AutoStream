'use strict';
const PORT = process.env.PORT || 7010;
const AUTOSTREAM_DEBUG = process.env.AUTOSTREAM_DEBUG === '1';

// Cloudflare Worker proxy URL - set in Render environment to bypass IP blocks
const CF_PROXY_URL = process.env.CF_PROXY_URL || '';

const BASE_TORRENTIO = 'https://torrentio.strem.fun';
const BASE_TPB = 'https://thepiratebay-plus.strem.fun';
const BASE_CINEMETA = 'https://v3-cinemeta.strem.io/meta';
const BASE_NUVIO = process.env.BASE_NUVIO || 'https://nuviostreams.hayd.uk';

// MediaFusion and Comet - ElfHosted public instances
// These addons use path-based configuration:
// - Comet: base64-encoded JSON config, e.g. /eyJkZWJyaWRTZXJ2aWNlIjoidG9ycmVudCJ9/stream/...
// - MediaFusion: encrypted secret string, e.g. /D-/stream/... (D- = direct/no streaming provider)
// For public use without debrid, we use minimal configs
const BASE_MEDIAFUSION = process.env.BASE_MEDIAFUSION || 'https://mediafusion.elfhosted.com';
const BASE_COMET = process.env.BASE_COMET || 'https://comet.elfhosted.com';

// Default configurations for public instance access (base64 encoded JSON for Comet)
// Comet config: {"debridService":"torrent"} = direct torrent mode (no debrid required)
const COMET_DEFAULT_CONFIG = Buffer.from(JSON.stringify({
  debridService: "torrent",
  maxResultsPerResolution: 0,
  maxSize: 0,
  resultFormat: ["all"]
})).toString('base64');

// MediaFusion config: "D-" = direct/no streaming provider (public access)
const MEDIAFUSION_DEFAULT_CONFIG = 'D-';

const NO_DEBRID_WEIGHTS = { quality: 0.5, speed: 1.0 };
const DEBRID_WEIGHTS = { quality: 1.0, speed: 0.7 };

module.exports = { 
  PORT, 
  AUTOSTREAM_DEBUG, 
  CF_PROXY_URL, 
  BASE_TORRENTIO, 
  BASE_TPB, 
  BASE_CINEMETA, 
  BASE_NUVIO,
  BASE_MEDIAFUSION,
  BASE_COMET,
  COMET_DEFAULT_CONFIG,
  MEDIAFUSION_DEFAULT_CONFIG,
  NO_DEBRID_WEIGHTS, 
  DEBRID_WEIGHTS 
};
