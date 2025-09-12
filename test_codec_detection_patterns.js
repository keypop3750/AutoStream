/**
 * Test to intercept stream data BEFORE naming to see original torrent info
 */

const http = require('http');

// Test resolution detection function directly
function extractResolution(streamTitle, streamName) {
  const title = ((streamTitle || '') + ' ' + (streamName || '')).toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(title)) return '4K';
  if (/\b(1080p|fhd)\b/.test(title)) return '1080p';
  if (/\b(720p|hd)\b/.test(title)) return '720p';
  if (/\b(480p|sd)\b/.test(title)) return '480p';
  return 'unknown';
}

function extractCodec(streamTitle, streamName) {
  const title = ((streamTitle || '') + ' ' + (streamName || '')).toLowerCase();
  if (/\b(x265|hevc|h\.?265)\b/.test(title)) return 'x265/HEVC';
  if (/\b(x264|avc|h\.?264)\b/.test(title)) return 'x264/AVC';
  return 'unknown';
}

// Test with some realistic torrent names
function testResolutionDetection() {
  console.log('\n🧪 TESTING RESOLUTION/CODEC DETECTION PATTERNS\n');
  
  const testNames = [
    'Breaking.Bad.2008.2160p.BluRay.x265.10bit.HDR.DTS-X.7.1-SWTYBLZ',
    'Breaking.Bad.2008.1080p.BluRay.x264.DTS-HD.MA.5.1-RARBG',
    'Gen.V.S01E03.2160p.AMZN.WEB-DL.x265.10bit.HDR10Plus.DDP5.1.Atmos-FLUX',
    'Gen.V.S01E03.1080p.AMZN.WEB-DL.x264.DD+5.1-NTG',
    'The.White.Lotus.S02E07.720p.HDTV.x264-SYNCOPY',
    'Better.Call.Saul.S06E13.480p.WEB.x264-mSD'
  ];
  
  testNames.forEach(name => {
    const resolution = extractResolution('', name);
    const codec = extractCodec('', name);
    console.log(`📺 "${name}"`);
    console.log(`   Resolution: ${resolution}, Codec: ${codec}\n`);
  });
}

// Check if our scoring system is seeing original torrent names
async function testOriginalTorrentNames() {
  console.log('\n🔍 CHECKING IF SCORING SYSTEM SEES ORIGINAL TORRENT NAMES\n');
  
  // We need to modify the scoring system temporarily to log what it sees
  // For now, let's test the manual patterns
  
  const sampleTorrentNames = [
    'Breaking.Bad.2008.2160p.BluRay.x265.10bit.HDR.DTS-X.7.1-SWTYBLZ',
    'Breaking.Bad.2008.1080p.BluRay.x264.DTS-HD.MA.5.1-RARBG'
  ];
  
  sampleTorrentNames.forEach(name => {
    console.log(`🎬 Torrent: ${name}`);
    
    // Simulate device-aware scoring
    const isTV = true; // Simulate Android TV
    
    let score = 0;
    const factors = [];
    
    // Resolution scoring
    if (/\b(2160p|4k|uhd)\b/.test(name.toLowerCase())) {
      score += 30;
      factors.push('4k_base(+30)');
    } else if (/\b(1080p|fhd)\b/.test(name.toLowerCase())) {
      score += 20;
      factors.push('1080p_base(+20)');
    }
    
    // Codec scoring for TV
    if (/\b(x265|hevc|h\.?265)\b/.test(name.toLowerCase())) {
      if (isTV) {
        score -= 2; // Minimal penalty - just enough to prefer x264 within same resolution
        factors.push('x265_tv_penalty(-2)');
      }
    } else if (/\b(x264|avc|h\.?264)\b/.test(name.toLowerCase())) {
      if (isTV) {
        score += 8; // Smaller bonus - enough to prefer x264 within resolution
        factors.push('x264_tv_bonus(+8)');
      }
    }
    
    console.log(`   📊 Score: ${score} (${factors.join(', ')})`);
    console.log('');
  });
}

if (require.main === module) {
  testResolutionDetection();
  testOriginalTorrentNames();
}
