/**
 * Generate all PWA icon sizes from a single source PNG.
 *
 * Pipeline for each output:
 *   1. Trim whitespace from the source — the user's hand-drawn double-heart
 *      image has lots of empty white space and the hearts sit off-center.
 *   2. Pad to a square (so the trimmed content is centered).
 *   3. Resize to the target dimension.
 *   4. Composite onto the brand pink background (transparent PNGs would
 *      look wrong inside iOS's rounded squircle).
 *   5. For maskable icons, leave a 20% safe-area inset so Android's
 *      adaptive-icon mask doesn't crop the hearts.
 *
 * Run: `node scripts/gen-icons.mjs`
 */
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SOURCE = resolve(ROOT, 'public/icons/heart-source.png')
const OUT_DIR = resolve(ROOT, 'public/icons')

const BRAND_PINK = { r: 0xFF, g: 0xF8, b: 0xFB, alpha: 1 } // --pink-50

// "any" = standard icon, hearts fill ~80% of the canvas
// "maskable" = Android adaptive icon, hearts fill ~60% (20% safe inset)
const TARGETS = [
  { name: 'icon-192.png',           size: 192, contentRatio: 0.80, bg: BRAND_PINK },
  { name: 'icon-512.png',           size: 512, contentRatio: 0.80, bg: BRAND_PINK },
  { name: 'icon-maskable-512.png',  size: 512, contentRatio: 0.60, bg: BRAND_PINK },
  // 180x180 transparent for iOS apple-touch-icon — iOS already paints a
  // white bg behind the icon so we keep this one transparent for crispness
  { name: 'apple-touch-icon.png',   size: 180, contentRatio: 0.80, bg: { r: 255, g: 255, b: 255, alpha: 1 } },
]

async function generate(target) {
  const { name, size, contentRatio, bg } = target
  const outPath = resolve(OUT_DIR, name)

  // Step 1: trim whitespace, then resize the trimmed content to
  // (size * contentRatio) so it fills only the central portion.
  const innerSize = Math.round(size * contentRatio)

  const trimmed = await sharp(SOURCE)
    // threshold=240 trims off pixels brighter than that (white-ish) — the
    // hand-drawn image has slightly off-white background so a strict 255
    // threshold wouldn't work
    .trim({ threshold: 10, background: '#ffffff' })
    .resize(innerSize, innerSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer()

  // Step 2: composite onto a square brand-pink canvas with the inner
  // content centered.
  const offset = Math.round((size - innerSize) / 2)
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: bg,
    },
  })
    .composite([{ input: trimmed, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toFile(outPath)

  console.log(`✓ ${name}  (${size}x${size}, content ${innerSize}x${innerSize})`)
}

async function main() {
  // Sanity check
  try {
    await sharp(SOURCE).metadata()
  } catch {
    console.error(`\n✗ Source not found: ${SOURCE}`)
    console.error(`  Save your heart artwork there, then re-run this script.\n`)
    process.exit(1)
  }

  await mkdir(OUT_DIR, { recursive: true })
  for (const t of TARGETS) await generate(t)
  console.log(`\nAll icons written to ${OUT_DIR}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
