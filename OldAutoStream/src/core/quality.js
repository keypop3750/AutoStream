'use strict';
function qualityToRank(label) {
  const lower = (label || '').toLowerCase();
  if (lower.includes('8k')) return 5;
  if (lower.includes('4320') || lower.includes('2160') || lower.includes('4k')) return 4;
  if (lower.includes('1440') || lower.includes('2k')) return 3;
  if (lower.includes('1080')) return 2;
  if (lower.includes('720')) return 1;
  return 0;
}

function normaliseQuality(label) {
  const lower = (label || '').toLowerCase();
  if (lower.includes('8k') || lower.includes('4320')) return '8K';
  if (lower.includes('2160') || lower.includes('4k')) return '4K';
  if (lower.includes('1440') || lower.includes('2k')) return '2K';
  if (lower.includes('1080')) return '1080p';
  if (lower.includes('720')) return '720p';
  if (lower.includes('480')) return '480p';
  return (label || '').trim() || 'unknown';
}

function parseSize(sizeText) {
  if (!sizeText) return 0;
  const parts = sizeText.trim().split(/\s+/);
  const value = parseFloat(parts[0].replace(/,/g, ''));
  const unit = parts[1] ? parts[1].toUpperCase() : '';
  if (Number.isNaN(value)) return 0;
  let scale = 1;
  if (unit.startsWith('T')) scale = 1024 ** 4;
  else if (unit.startsWith('G')) scale = 1024 ** 3;
  else if (unit.startsWith('M')) scale = 1024 ** 2;
  else if (unit.startsWith('K')) scale = 1024;
  return value * scale;
}

function extractSeedersAndSize(title) {
  if (!title) return { seeders: 0, size: 0 };
  const lines = title.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const seeders = parseInt(parts[0], 10);
    const sizeText = parts[1] && parts[2] ? parts[1] + ' ' + parts[2] : undefined;
    const sizeBytes = parseSize(sizeText);
    return {
      seeders: Number.isFinite(seeders) ? seeders : 0,
      size: sizeBytes,
    };
  }
  return { seeders: 0, size: 0 };
}

module.exports = { qualityToRank, normaliseQuality, parseSize, extractSeedersAndSize };
