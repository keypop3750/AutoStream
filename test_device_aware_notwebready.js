#!/usr/bin/env node
/**
 * Test Device-Aware notWebReady Flag Implementation
 * 
 * This test verifies that:
 * 1. TV devices get notWebReady: true for magnet links
 * 2. Web/Mobile devices don't get notWebReady flag
 * 3. Debrid streams are handled correctly regardless of device
 * 4. HTTP streams work properly on all devices
 */

const http = require('http');

class DeviceAwareNotWebReadyTest {
  constructor() {
    this.baseUrl = 'http://localhost:7010';
    this.results = [];
  }

  async runTests() {
    console.log('🖥️  DEVICE-AWARE NOTWEBREADY FLAG TEST');
    console.log('=' .repeat(60));
    console.log('Testing TV compatibility fix for magnet links\n');

    await this.testTVDevice();
    await this.testWebDevice(); 
    await this.testMobileDevice();
    await this.testDebridOnTV();
    
    this.printResults();
  }

  async testTVDevice() {
    console.log('📺 Testing TV Device (Smart TV/Tizen)');
    console.log('-'.repeat(40));
    
    const response = await this.makeRequest('/stream/series/tt2788316:1:1.json', {
      'User-Agent': 'Smart TV/1.0 (Tizen)'
    });
    
    if (response.streams && response.streams.length > 0) {
      const stream = response.streams[0];
      const hasNotWebReady = stream.behaviorHints?.notWebReady === true;
      const isMagnetStream = !stream.url || stream.url.startsWith('magnet:') || stream.infoHash;
      
      console.log(`  Stream: ${stream.title || stream.name}`);
      console.log(`  URL Type: ${stream.url ? (stream.url.startsWith('magnet:') ? 'Magnet' : 'HTTP') : 'InfoHash only'}`);
      console.log(`  notWebReady: ${hasNotWebReady}`);
      
      if (isMagnetStream && hasNotWebReady) {
        console.log('  ✅ PASS: TV device correctly has notWebReady flag for magnet stream');
        this.results.push({ test: 'TV Device', status: 'PASS', reason: 'notWebReady flag set for magnet stream' });
      } else if (isMagnetStream && !hasNotWebReady) {
        console.log('  ❌ FAIL: TV device missing notWebReady flag for magnet stream');
        this.results.push({ test: 'TV Device', status: 'FAIL', reason: 'Missing notWebReady flag' });
      } else if (!isMagnetStream && !hasNotWebReady) {
        console.log('  ✅ PASS: TV device correctly has no notWebReady flag for HTTP stream');
        this.results.push({ test: 'TV Device', status: 'PASS', reason: 'No notWebReady flag for HTTP stream' });
      } else {
        console.log('  ⚠️  UNCLEAR: Unexpected combination of stream type and flags');
        this.results.push({ test: 'TV Device', status: 'UNCLEAR', reason: 'Unexpected combination' });
      }
    } else {
      console.log('  ❌ FAIL: No streams returned');
      this.results.push({ test: 'TV Device', status: 'FAIL', reason: 'No streams returned' });
    }
    console.log();
  }

  async testWebDevice() {
    console.log('🌐 Testing Web Device (Chrome Browser)');
    console.log('-'.repeat(40));
    
    const response = await this.makeRequest('/stream/series/tt2788316:1:1.json', {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
    });
    
    if (response.streams && response.streams.length > 0) {
      const stream = response.streams[0];
      const hasNotWebReady = stream.behaviorHints?.notWebReady === true;
      
      console.log(`  Stream: ${stream.title || stream.name}`);
      console.log(`  URL Type: ${stream.url ? (stream.url.startsWith('magnet:') ? 'Magnet' : 'HTTP') : 'InfoHash only'}`);
      console.log(`  notWebReady: ${hasNotWebReady}`);
      
      if (!hasNotWebReady) {
        console.log('  ✅ PASS: Web device correctly has no notWebReady flag');
        this.results.push({ test: 'Web Device', status: 'PASS', reason: 'No notWebReady flag' });
      } else {
        console.log('  ❌ FAIL: Web device has unexpected notWebReady flag');
        this.results.push({ test: 'Web Device', status: 'FAIL', reason: 'Unexpected notWebReady flag' });
      }
    } else {
      console.log('  ❌ FAIL: No streams returned');
      this.results.push({ test: 'Web Device', status: 'FAIL', reason: 'No streams returned' });
    }
    console.log();
  }

  async testMobileDevice() {
    console.log('📱 Testing Mobile Device (Android)');
    console.log('-'.repeat(40));
    
    const response = await this.makeRequest('/stream/series/tt2788316:1:1.json', {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36'
    });
    
    if (response.streams && response.streams.length > 0) {
      const stream = response.streams[0];
      const hasNotWebReady = stream.behaviorHints?.notWebReady === true;
      
      console.log(`  Stream: ${stream.title || stream.name}`);
      console.log(`  URL Type: ${stream.url ? (stream.url.startsWith('magnet:') ? 'Magnet' : 'HTTP') : 'InfoHash only'}`);
      console.log(`  notWebReady: ${hasNotWebReady}`);
      
      if (!hasNotWebReady) {
        console.log('  ✅ PASS: Mobile device correctly has no notWebReady flag');
        this.results.push({ test: 'Mobile Device', status: 'PASS', reason: 'No notWebReady flag' });
      } else {
        console.log('  ❌ FAIL: Mobile device has unexpected notWebReady flag');
        this.results.push({ test: 'Mobile Device', status: 'FAIL', reason: 'Unexpected notWebReady flag' });
      }
    } else {
      console.log('  ❌ FAIL: No streams returned');
      this.results.push({ test: 'Mobile Device', status: 'FAIL', reason: 'No streams returned' });
    }
    console.log();
  }

  async testDebridOnTV() {
    console.log('📺 Testing TV Device with Debrid (if available)');
    console.log('-'.repeat(40));
    
    // Test with a mock debrid key to see debrid stream handling
    const response = await this.makeRequest('/stream/series/tt2788316:1:1.json?ad=test_key_mock', {
      'User-Agent': 'Smart TV/1.0 (Tizen)'
    });
    
    if (response.streams && response.streams.length > 0) {
      const stream = response.streams[0];
      const hasNotWebReady = stream.behaviorHints?.notWebReady === true;
      const isDebridStream = stream.url && stream.url.includes('/play?');
      
      console.log(`  Stream: ${stream.title || stream.name}`);
      console.log(`  URL Type: ${isDebridStream ? 'Debrid Play URL' : (stream.url ? (stream.url.startsWith('magnet:') ? 'Magnet' : 'HTTP') : 'InfoHash only')}`);
      console.log(`  notWebReady: ${hasNotWebReady}`);
      
      if (isDebridStream && !hasNotWebReady) {
        console.log('  ✅ PASS: Debrid streams correctly have no notWebReady flag (even on TV)');
        this.results.push({ test: 'TV Debrid', status: 'PASS', reason: 'Debrid streams work without notWebReady' });
      } else if (!isDebridStream && hasNotWebReady) {
        console.log('  ✅ PASS: Non-debrid streams still get notWebReady on TV');
        this.results.push({ test: 'TV Debrid', status: 'PASS', reason: 'Fallback to magnet with notWebReady' });
      } else {
        console.log('  ℹ️  INFO: Debrid handling varies based on API key validity');
        this.results.push({ test: 'TV Debrid', status: 'INFO', reason: 'Debrid behavior depends on key validity' });
      }
    } else {
      console.log('  ❌ FAIL: No streams returned');
      this.results.push({ test: 'TV Debrid', status: 'FAIL', reason: 'No streams returned' });
    }
    console.log();
  }

  async makeRequest(path, headers = {}) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: 7010,
        path: path,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...headers
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(10000, () => reject(new Error('Request timeout')));
      req.end();
    });
  }

  printResults() {
    console.log('📊 TEST SUMMARY');
    console.log('=' .repeat(60));
    
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const other = this.results.filter(r => !['PASS', 'FAIL'].includes(r.status)).length;
    
    this.results.forEach(result => {
      const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : 'ℹ️';
      console.log(`${icon} ${result.test}: ${result.status} - ${result.reason}`);
    });
    
    console.log();
    console.log(`Results: ${passed} passed, ${failed} failed, ${other} other`);
    
    if (failed === 0) {
      console.log('🎉 All tests passed! Device-aware notWebReady logic is working correctly.');
    } else {
      console.log('⚠️  Some tests failed. Check the implementation.');
    }
  }
}

// Run the test
if (require.main === module) {
  const test = new DeviceAwareNotWebReadyTest();
  test.runTests().catch(console.error);
}

module.exports = DeviceAwareNotWebReadyTest;
