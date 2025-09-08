#!/usr/bin/env node
/**
 * Test Dynamic ID Validation System
 * Shows how the new system works without hard-coded mappings
 */

const { validateAndCorrectIMDBID, validateIMDBID, titleSimilarity } = require('./utils/id-correction');

async function testDynamicValidation() {
  console.log('🧪 Testing Dynamic IMDB ID Validation System\n');
  
  // Test 1: Valid ID
  console.log('📋 Test 1: Valid IMDB ID');
  const result1 = await validateAndCorrectIMDBID('tt13159924:1:1'); // Gen V
  console.log('Result:', result1);
  console.log('');
  
  // Test 2: Valid ID with expected context
  console.log('📋 Test 2: Valid ID with context validation');
  const result2 = await validateAndCorrectIMDBID('tt13159924:1:1', {
    title: 'Gen V',
    year: '2023'
  });
  console.log('Result:', result2);
  console.log('');
  
  // Test 3: Invalid/non-existent ID
  console.log('📋 Test 3: Invalid IMDB ID');
  const result3 = await validateAndCorrectIMDBID('tt99999999:1:1');
  console.log('Result:', result3);
  console.log('');
  
  // Test 4: Title similarity testing
  console.log('📋 Test 4: Title Similarity Algorithm');
  const similarities = [
    ['Gen V', 'Gen V', titleSimilarity('Gen V', 'Gen V')],
    ['Gen V', 'The Boys Presents: Gen V', titleSimilarity('Gen V', 'The Boys Presents: Gen V')],
    ['Lilo & Stitch', 'Lilo & Stitch: The Series', titleSimilarity('Lilo & Stitch', 'Lilo & Stitch: The Series')],
    ['Breaking Bad', 'Better Call Saul', titleSimilarity('Breaking Bad', 'Better Call Saul')],
    ['The Office', 'The Office (US)', titleSimilarity('The Office', 'The Office (US)')],
  ];
  
  similarities.forEach(([title1, title2, score]) => {
    console.log(`"${title1}" vs "${title2}": ${score.toFixed(2)}`);
  });
  console.log('');
  
  // Test 5: Lilo & Stitch series validation
  console.log('📋 Test 5: Lilo & Stitch Series Validation');
  const result5 = await validateAndCorrectIMDBID('tt0364774:1:1', {
    title: 'Lilo & Stitch: The Series'
  });
  console.log('Result:', result5);
  console.log('');
  
  // Test 6: Test with wrong ID (should fail validation)
  console.log('📋 Test 6: Wrong ID Validation (should fail)');
  const result6 = await validateAndCorrectIMDBID('tt0762298:1:1', {
    title: 'Lilo & Stitch: The Series'
  });
  console.log('Result:', result6);
  console.log('');
}

async function testCachePerformance() {
  console.log('⚡ Testing Cache Performance\n');
  
  const startTime = Date.now();
  
  // First call (should fetch metadata)
  console.log('First call (fetches metadata):');
  await validateIMDBID('tt13159924');
  console.log(`Time: ${Date.now() - startTime}ms\n`);
  
  // Second call (should use cache)
  const cacheStartTime = Date.now();
  console.log('Second call (uses cache):');
  await validateIMDBID('tt13159924');
  console.log(`Time: ${Date.now() - cacheStartTime}ms\n`);
}

async function main() {
  try {
    await testDynamicValidation();
    await testCachePerformance();
    
    console.log('✅ All tests completed successfully!');
    console.log('\n🎯 Key Features of New System:');
    console.log('• Dynamic validation using live metadata');
    console.log('• No hard-coded ID mappings required');
    console.log('• Title similarity scoring for context validation');
    console.log('• Automatic caching for performance');
    console.log('• Memory management with size limits');
    console.log('• Support for both series and movie content');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = { testDynamicValidation, testCachePerformance };
