// AutoStream Cloudflare Worker Proxy
// Designed to bypass IP blocks on Torrentio/TPB from Render

// Build headers that mimic a real browser - avoid CF-to-CF detection
function buildBrowserHeaders(targetUrl) {
  const targetHost = new URL(targetUrl).hostname;
  
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Origin': `https://${targetHost}`,
    'Referer': `https://${targetHost}/`,
    // Remove CF-specific headers that might trigger blocking
  };
}

// Fetch a single URL with retry logic
async function fetchSingleUrl(targetUrl, method = 'GET', body = null, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = new Headers(buildBrowserHeaders(targetUrl));
      
      if (method === 'POST') {
        headers.set('Content-Type', 'application/x-www-form-urlencoded');
      }
      
      const response = await fetch(targetUrl, {
        method,
        headers,
        body,
        redirect: 'follow',
        cf: {
          // Cloudflare-specific options to help avoid detection
          cacheTtl: 0,
          cacheEverything: false,
          scrapeShield: false,
        }
      });
      
      const responseBody = await response.text();
      
      // Check if we got a Cloudflare block page
      if (response.status === 403 && responseBody.includes('Cloudflare')) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
      }
      
      return {
        url: targetUrl,
        status: response.status,
        contentType: response.headers.get('Content-Type') || 'application/json',
        body: responseBody,
        success: response.status >= 200 && response.status < 400
      };
    } catch (error) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return {
        url: targetUrl,
        status: 0,
        error: error.message,
        success: false
      };
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');
    const batchUrls = url.searchParams.get('urls');
    const methodOverride = url.searchParams.get('method');
    const bodyParam = url.searchParams.get('body');

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, timestamp: Date.now() }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // ===== BATCH MODE =====
    if (batchUrls) {
      try {
        const urlList = batchUrls.split(',')
          .map(u => decodeURIComponent(u.trim()))
          .filter(u => u.startsWith('http'))
          .slice(0, 20);
        
        if (urlList.length === 0) {
          return new Response(JSON.stringify({ error: 'No valid URLs provided' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
        
        const results = await Promise.all(
          urlList.map(targetUrl => fetchSingleUrl(targetUrl, methodOverride || 'GET', bodyParam ? decodeURIComponent(bodyParam) : null))
        );
        
        return new Response(JSON.stringify(results), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'X-Batch-Count': results.length.toString(),
            'X-Batch-Success': results.filter(r => r.success).length.toString(),
          },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // ===== SINGLE URL MODE =====
    if (!targetUrl) {
      return new Response(JSON.stringify({ 
        error: 'Missing url or urls parameter',
        usage: {
          single: '?url=<encoded_url>',
          batch: '?urls=<url1>,<url2>,... (max 20)',
          health: '/health'
        }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    try {
      const decodedUrl = decodeURIComponent(targetUrl);
      const actualMethod = methodOverride || request.method;
      
      let body = null;
      if (actualMethod === 'POST') {
        if (bodyParam) {
          body = decodeURIComponent(bodyParam);
        } else if (request.method === 'POST') {
          body = await request.text();
        }
      }

      const result = await fetchSingleUrl(decodedUrl, actualMethod, body);

      // Return the body directly for backwards compatibility
      return new Response(result.body || JSON.stringify({ error: result.error }), {
        status: result.status || 500,
        headers: {
          'Content-Type': result.contentType || 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Proxied-Status': (result.status || 0).toString(),
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
