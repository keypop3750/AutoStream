const { buildContentTitle, extractResolution } = require('./core/format');

console.log('🧪 Testing resolution extraction timing...\n');

// Test both filename locations to match real server data
const stream1 = {
  title: "Gen V S1E1",
  name: "AutoStream",
  filename: "Gen.V.S01E01.God.U.2160p.AMZN.WEB-DL.DDP5.1.HDR.H.265-NTb.mkv"  // Direct filename
};

const stream2 = {
  title: "Gen V S1E1", 
  name: "AutoStream",
  filename: "Gen V (2023) - S01E01 - God U. (1080p BluRay x265 Silence).mkv"  // Direct filename
};

const stream3 = {
  title: "Gen V S1E1",
  name: "AutoStream",
  behaviorHints: {
    filename: "Gen.V.S01E01.God.U.2160p.AMZN.WEB-DL.DDP5.1.HDR.H.265-NTb.mkv"  // behaviorHints filename
  }
};

console.log('📊 Stream 1 Analysis (direct filename):');
console.log('  Title:', stream1.title);
console.log('  Filename:', stream1.filename);
console.log('  Extracted Resolution:', extractResolution(stream1));
console.log('  Built Title:', buildContentTitle('Gen V', stream1, { type: 'series', id: 'tt13623136:1:1' }));

console.log('\n📊 Stream 2 Analysis (direct filename):');
console.log('  Title:', stream2.title);
console.log('  Filename:', stream2.filename);
console.log('  Extracted Resolution:', extractResolution(stream2));
console.log('  Built Title:', buildContentTitle('Gen V', stream2, { type: 'series', id: 'tt13623136:1:1' }));

console.log('\n� Stream 3 Analysis (behaviorHints filename):');
console.log('  Title:', stream3.title);
console.log('  Filename:', stream3.behaviorHints?.filename);
console.log('  Extracted Resolution:', extractResolution(stream3));
console.log('  Built Title:', buildContentTitle('Gen V', stream3, { type: 'series', id: 'tt13623136:1:1' }));
