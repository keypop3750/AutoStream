/**
 * Stream Quality Validation Service
 * 
 * This service performs HTTP probes to validate direct stream quality
 * including reachability, seekability, content type, size, and throughput.
 * 
 * Usage:
 * const validator = require('./services/streamValidator');
 * const result = await validator.validateStream(streamUrl, expectedQuality);
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// Quality expectations for different resolutions
const QUALITY_THRESHOLDS = {
  '720p': { minSizeMB: 300, minMbps: 4, maxMbps: 8 },
  '1080p': { minSizeMB: 700, minMbps: 8, maxMbps: 15 },
  '1080p_hevc': { minSizeMB: 500, minMbps: 6, maxMbps: 12 },
  '4k_sdr': { minSizeMB: 3000, minMbps: 15, maxMbps: 30 },
  '4k_hdr': { minSizeMB: 8000, minMbps: 30, maxMbps: 80 }
};

/**
 * Validate stream quality through HTTP probes
 */
async function validateStream(streamUrl, expectedQuality = '1080p', options = {}) {
  const { timeout = 5000, followRedirects = 3, userAgent = 'AutoStream/1.0' } = options;
  
  try {
    const result = {
      url: streamUrl,
      quality: expectedQuality,
      timestamp: Date.now(),
      reachable: false,
      seekable: false,
      contentType: null,
      sizeMB: null,
      throughputMbps: null,
      latencyMs: null,
      resumable: false,
      score: -100, // Default fail score
      issues: []
    };
    
    // Step 1: Reachability test (HEAD request)
    const headResult = await testReachability(streamUrl, { timeout, followRedirects, userAgent });
    result.reachable = headResult.reachable;
    result.contentType = headResult.contentType;
    result.sizeMB = headResult.sizeMB;
    result.latencyMs = headResult.latencyMs;
    
    if (!result.reachable) {
      result.issues.push('unreachable');
      return result;
    }
    
    // Step 2: Seekability test (Range request)
    const seekResult = await testSeekability(streamUrl, { timeout, userAgent });
    result.seekable = seekResult.seekable;
    result.throughputMbps = seekResult.throughputMbps;
    
    if (!result.seekable) {
      result.issues.push('not_seekable');
      result.score = -80; // Big penalty for non-seekable streams
    }
    
    // Step 3: Content validation
    if (!isValidVideoContent(result.contentType)) {
      result.issues.push('invalid_content_type');
      result.score = -100; // Drop non-video content
      return result;
    }
    
    // Step 4: Size validation
    const threshold = QUALITY_THRESHOLDS[expectedQuality] || QUALITY_THRESHOLDS['1080p'];
    if (result.sizeMB && result.sizeMB < threshold.minSizeMB) {
      result.issues.push('too_small');
      result.score = Math.max(result.score, -60);
    }
    
    // Step 5: Throughput validation
    if (result.throughputMbps && result.throughputMbps < threshold.minMbps) {
      result.issues.push('slow_throughput');
      result.score = Math.max(result.score, -40);
    }
    
    // Step 6: Calculate final score
    if (result.issues.length === 0) {
      result.score = 10; // Good stream bonus
    } else if (result.reachable && result.seekable) {
      result.score = 0; // Neutral if basic functionality works
    }
    
    return result;
    
  } catch (error) {
    return {
      url: streamUrl,
      error: error.message,
      score: -100,
      issues: ['validation_failed']
    };
  }
}

/**
 * Test stream reachability with HEAD request
 */
async function testReachability(url, options) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const { timeout, followRedirects, userAgent } = options;
    
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = client.request({
      method: 'HEAD',
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { 'User-Agent': userAgent },
      timeout
    }, (res) => {
      const latencyMs = Date.now() - startTime;
      
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && followRedirects > 0) {
        const location = res.headers.location;
        if (location) {
          resolve(testReachability(location, { ...options, followRedirects: followRedirects - 1 }));
          return;
        }
      }
      
      const reachable = res.statusCode === 200 || res.statusCode === 206;
      const contentType = res.headers['content-type'] || '';
      const contentLength = parseInt(res.headers['content-length'] || '0', 10);
      const sizeMB = contentLength > 0 ? Math.round(contentLength / (1024 * 1024)) : null;
      
      resolve({
        reachable,
        statusCode: res.statusCode,
        contentType,
        sizeMB,
        latencyMs
      });
    });
    
    req.on('error', () => {
      resolve({ reachable: false, latencyMs: Date.now() - startTime });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ reachable: false, latencyMs: timeout });
    });
    
    req.end();
  });
}

/**
 * Test stream seekability with Range request
 */
async function testSeekability(url, options) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const { timeout, userAgent } = options;
    
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = client.request({
      method: 'GET',
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { 
        'User-Agent': userAgent,
        'Range': 'bytes=0-1023' // Request first 1KB
      },
      timeout
    }, (res) => {
      const seekable = res.statusCode === 206 && res.headers['content-range'];
      let dataReceived = 0;
      
      res.on('data', (chunk) => {
        dataReceived += chunk.length;
      });
      
      res.on('end', () => {
        const durationMs = Date.now() - startTime;
        const throughputMbps = dataReceived > 0 ? 
          Math.round((dataReceived * 8) / (durationMs * 1000) * 1000) : 0;
        
        resolve({
          seekable,
          throughputMbps,
          dataReceived,
          durationMs
        });
      });
    });
    
    req.on('error', () => {
      resolve({ seekable: false, throughputMbps: 0 });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ seekable: false, throughputMbps: 0 });
    });
    
    req.end();
  });
}

/**
 * Check if content type is valid video
 */
function isValidVideoContent(contentType) {
  if (!contentType) return false;
  
  const validTypes = [
    'video/',
    'application/octet-stream',
    'binary/octet-stream'
  ];
  
  const invalidTypes = [
    'text/html',
    'text/plain',
    'application/json',
    'text/xml'
  ];
  
  const lowerType = contentType.toLowerCase();
  
  if (invalidTypes.some(invalid => lowerType.includes(invalid))) {
    return false;
  }
  
  return validTypes.some(valid => lowerType.includes(valid));
}

module.exports = {
  validateStream,
  QUALITY_THRESHOLDS
};
