// This file mirrors the root-level autostream_addon.js to provide a complete
// Node.js entry point for the AutoStream addon when published as a
// standalone repository.  It is identical to the version in the
// repository root.

const fs = require('fs');
const path = require('path');

// Export the code from the root-level file.  This allows us to reuse
// the implementation without duplication.  When Node runs this
// script, it simply requires the sibling file one directory up.
module.exports = require('../autostream_addon.js');