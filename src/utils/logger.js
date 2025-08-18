'use strict';
let _reqIdSeq = 0;
function createLogger(enabled, prefix) {
  const id = (++_reqIdSeq).toString().padStart(4, '0');
  const pfx = prefix ? `[${id}] ${prefix}` : `[${id}]`;
  const fn = (...args) => { if (enabled) console.log(pfx, ...args); };
  fn.error = (...args) => console.error(pfx, ...args);
  fn.id = id;
  return fn;
}

module.exports = { createLogger };
