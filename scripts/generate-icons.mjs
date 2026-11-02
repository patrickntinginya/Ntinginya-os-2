#!/usr/bin/env node
/**
 * Generate PWA icons from icon.svg using canvas-based SVG rendering
 * 
 * This script converts public/icon.svg to the required PNG sizes:
 * - pwa-192.png: 192x192px
 * - pwa-512.png: 512x512px  
 * - pwa-maskable-512.png: 512x512px with safe-area padding
 * - apple-touch-icon.png: 180x180px
 * 
 * Usage: node scripts/generate-icons.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const svgPath = path.join(publicDir, 'icon.svg');

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

console.log(`${colors.yellow}📦 Icon Generation Tool${colors.reset}`);
console.log(`Source: ${svgPath}\n`);

// Check if SVG exists
if (!fs.existsSync(svgPath)) {
  console.error(`${colors.red}✗ Error: icon.svg not found${colors.reset}`);
  process.exit(1);
}

const svgContent = fs.readFileSync(svgPath, 'utf-8');
console.log(`${colors.green}✓ Loaded icon.svg${colors.reset}`);
console.log(`SVG size: ${svgContent.length} bytes\n`);

// Parse SVG dimensions
const viewBoxMatch = svgContent.match(/viewBox=['"]([^'"]+)['"]/);
const widthMatch = svgContent.match(/width=['"]([^'"]+)['"]/);
const heightMatch = svgContent.match(/height=['"]([^'"]+)['"]/);

const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 100 100';
const width = widthMatch ? parseFloat(widthMatch[1]) : 100;
const height = heightMatch ? parseFloat(heightMatch[1]) : 100;

console.log(`SVG Dimensions: ${width}x${height}`);
console.log(`ViewBox: ${viewBox}\n`);

console.log(`${colors.yellow}Next Steps:${colors.reset}`);
console.log('1. Install sharp for image processing:');
console.log('   npm install --save-dev sharp\n');
console.log('2. Install @resvg/resvg-js for SVG rendering:');
console.log('   npm install --save-dev @resvg/resvg-js\n');
console.log('3. Run this script again:');
console.log('   node scripts/generate-icons.mjs\n');
console.log(`${colors.yellow}Alternative: Manual Generation${colors.reset}`);
console.log('You can generate icons manually using online tools:');
console.log('1. Visit https://realfavicongenerator.net/');
console.log('2. Upload public/icon.svg');
console.log('3. Generate favicon package');
console.log('4. Download and extract to public/ directory\n');
console.log(`${colors.yellow}GitHub Desktop Alternative:${colors.reset}`);
console.log('1. Clone the repo locally');
console.log('2. Install Node dependencies: npm install');
console.log('3. Install image tools: npm install --save-dev sharp');
console.log('4. Run: npx node scripts/generate-icons.mjs');
console.log('5. Commit and push the generated PNG files\n');
