'use strict';

/**
 * Middleware Index
 * Exports all middleware modules
 */

const cors = require('./cors');
const rateLimiter = require('./rateLimiter');
const errorHandler = require('./errorHandler');

module.exports = {
 // CORS
 setCors: cors.setCors,
 handleOptionsRequest: cors.handleOptionsRequest,
 
 // Rate Limiting
 RateLimiter: rateLimiter.RateLimiter,
 generalRateLimiter: rateLimiter.generalRateLimiter,
 playRateLimiter: rateLimiter.playRateLimiter,
 
 // Error Handling
 safeStringify: errorHandler.safeStringify,
 createErrorResponse: errorHandler.createErrorResponse,
 writeJson: errorHandler.writeJson,
 sendError: errorHandler.sendError,
 setupGlobalErrorHandlers: errorHandler.setupGlobalErrorHandlers,
 wrapAsync: errorHandler.wrapAsync
};
