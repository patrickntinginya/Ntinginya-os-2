#!/usr/bin/env node

/**
 * Generate PWA icon files from SVG source
 * 
 * This script converts public/icon.svg to properly sized PNG icons:
 * - pwa-192.png: 192x192px (standard icon)
 * - pwa-512.png: 512x512px (standard icon)
 * - pwa-maskable-512.png: 512x512px (maskable icon with safe area)
 * - apple-touch-icon.png: 180x180px (iOS home screen)
 * 
 * Requirements: npm install --save-dev sharp
 * Usage: node scripts/generate-pwa-icons.js
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const svgPath = path.join(publicDir, 'icon.svg');

// Verify SVG exists
if (!fs.existsSync(svgPath)) {
  console.error(`❌ Error: SVG file not found at ${svgPath}`);
  console.error('Make sure public/icon.svg exists.');
  process.exit(1);
}

async function generateIcons() {
  try {
    console.log('📦 Generating PWA icons from icon.svg...\n');

    // Read the SVG file
    const svgBuffer = fs.readFileSync(svgPath);

    // Generate standard icons
    const sizes = [
      { size: 192, name: 'pwa-192.png', label: 'Standard (192x192)' },
      { size: 512, name: 'pwa-512.png', label: 'Standard (512x512)' },
      { size: 180, name: 'apple-touch-icon.png', label: 'Apple Touch Icon (180x180)' },
    ];

    for (const { size, name, label } of sizes) {
      await sharp(svgBuffer)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 245, g: 245, b: 243, alpha: 1 }, // #f4f5f3 from manifest
        })
        .png()
        .toFile(path.join(publicDir, name));
      console.log(`✅ Generated ${label}: ${name}`);
    }

    // Generate maskable icon
    // For maskable icons, the logo should be positioned in a safe zone
    // (center 66% of the icon to allow for adaptive masking)
    const maskableSize = 512;
    const padding = Math.round(maskableSize * 0.17); // 17% padding for safe area

    await sharp(svgBuffer)
      .resize(maskableSize - padding * 2, maskableSize - padding * 2, {
        fit: 'contain',
        background: { r: 245, g: 245, b: 243, alpha: 1 },
      })
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 245, g: 245, b: 243, alpha: 1 },
      })
      .png()
      .toFile(path.join(publicDir, 'pwa-maskable-512.png'));
    console.log(`✅ Generated Maskable Icon (512x512): pwa-maskable-512.png`);

    console.log('\n✨ All PWA icons generated successfully!');
    console.log('\nNext steps:');
    console.log('1. Commit the generated icon files to your repository');
    console.log('2. Verify vite.config.js includes the correct manifest configuration');
    console.log('3. Test the PWA installation on Android and desktop');
  } catch (error) {
    console.error('❌ Error generating icons:', error.message);
    process.exit(1);
  }
}

generateIcons();
