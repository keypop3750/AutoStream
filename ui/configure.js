'use strict';
const fs = require('fs');
const path = require('path');
let cached = null;

function configureHtml(){
  try {
    // Always reload in development to pick up changes
    const html = fs.readFileSync(path.join(__dirname, 'configure.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, 'configure.client.js'), 'utf8');
    return html.replace('<!-- INLINE_SCRIPT -->', `<script>${js.replace(/<\/script>/g,'<\\/script>')}</script>`);
  } catch (e) {
    return '<!doctype html><pre>Failed to load Configure UI: ' + String(e && (e.stack||e)) + '</pre>';
  }
}
module.exports = { configureHtml };
