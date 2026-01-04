'use strict';

/**
 * Error Handler Middleware
 * Centralized error handling and logging
 */

// Safe Error Serialization
function safeStringify(obj, maxDepth = 3) {
 const seen = new WeakSet();
 return JSON.stringify(obj, function(key, val) {
 if (val !== null && typeof val === 'object') {
 if (seen.has(val)) return '[Circular]';
 seen.add(val);
 }
 return val;
 });
}

// Standardized error response format
function createErrorResponse(code, message, details = null) {
 return {
 ok: false,
 error: message,
 code: code,
 ...(details && { details })
 };
}

// Write JSON response helper
function writeJson(res, obj, code = 200) {
 try {
 if (!res.headersSent) {
 res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
 }
 } catch (e) { 
 console.error('[writeJson] Failed to write headers:', e.message); 
 }
 try { 
 res.end(JSON.stringify(obj)); 
 } catch (e) { 
 console.error('[writeJson] Failed to serialize/send JSON:', e.message); 
 }
}

// Error response helper
function sendError(res, code, message, details = null) {
 writeJson(res, createErrorResponse(code, message, details), code);
}

// Global error handlers setup
function setupGlobalErrorHandlers() {
 // Unhandled Promise Rejection Handler (Prevents Node.js crashes)
 process.on('unhandledRejection', (reason, promise) => {
 console.error('[ALERT] Unhandled Promise Rejection:', reason);
 console.error('Promise:', promise);
 });

 // Uncaught Exception Handler (Last resort)
 process.on('uncaughtException', (error) => {
 console.error('[ALERT] Uncaught Exception:', error);
 });
}

// Request error wrapper
function wrapAsync(fn) {
 return async (req, res, ...args) => {
 try {
 await fn(req, res, ...args);
 } catch (error) {
 console.error(`[RequestError] ${req.method} ${req.url}:`, error.message);
 if (!res.headersSent) {
 sendError(res, 500, 'Internal server error', error.message);
 }
 }
 };
}

module.exports = {
 safeStringify,
 createErrorResponse,
 writeJson,
 sendError,
 setupGlobalErrorHandlers,
 wrapAsync
};
