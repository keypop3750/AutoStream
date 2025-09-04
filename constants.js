'use strict';
const PORT = process.env.PORT || 7010;
const AUTOSTREAM_DEBUG = process.env.AUTOSTREAM_DEBUG === '1';

const BASE_TORRENTIO = 'https://torrentio.strem.fun';
const BASE_TPB       = 'https://thepiratebay-plus.strem.fun';
const BASE_CINEMETA  = 'https://v3-cinemeta.strem.io/meta';
const BASE_NUVIO     = process.env.BASE_NUVIO || 'https://nuviostreams.hayd.uk';

const NO_DEBRID_WEIGHTS = { quality: 0.5, speed: 1.0 };
const DEBRID_WEIGHTS    = { quality: 1.0, speed: 0.7 };

module.exports = { PORT, AUTOSTREAM_DEBUG, BASE_TORRENTIO, BASE_TPB, BASE_CINEMETA, BASE_NUVIO, NO_DEBRID_WEIGHTS, DEBRID_WEIGHTS };
