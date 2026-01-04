'use strict';

/**
 * CORS Middleware
 * Sets Cross-Origin Resource Sharing headers for Stremio compatibility
 */

function setCors(res) {
 try {
 res.setHeader('Access-Control-Allow-Origin', '*');
 res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
 res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Accept, X-Requested-With, User-Agent');
 res.setHeader('Access-Control-Max-Age', '86400');
 // Mobile Stremio compatibility headers
 res.setHeader('Cache-Control', 'public, max-age=3600');
 } catch (e) { 
 console.error('[setCors] Failed to set headers:', e.message); 
 }
}

function handleOptionsRequest(req, res) {
 setCors(res);
 res.writeHead(204, {
 'Access-Control-Allow-Origin': '*',
 'Access-Control-Allow-Methods': 'GET, OPTIONS, POST',
 'Access-Control-Allow-Headers': 'Content-Type, Range, Accept, X-Requested-With, User-Agent',
 'Access-Control-Max-Age': '86400'
 });
 res.end();
 return true;
}

module.exports = {
 setCors,
 handleOptionsRequest
};
