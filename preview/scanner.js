// AI product scanner: looks at product photos and reads the name, size, colour, material and any label text.
// Uses Claude (vision) with a fixed JSON answer shape.
const Anthropic = require('@anthropic-ai/sdk')
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod')
const { z } = require('zod')

const MODEL = 'claude-opus-5-5'
const LANG_NAME = { en: 'English', so: 'Somali', zh: 'Simplified Chinese' }

const Result = z.object({
  name: z.string().describe('Exact trade name: material + kind + use, e.g. "Plastic ice cream cup", "Kraft paper bag", "Double cup holder" — never a bare word like "cup" or "bag". In the requested language'),
  name_options: z.array(z.string()).describe('2-4 other specific trade names it could be, most likely first, same language'),
  name_en: z.string().describe('The same product name in English'),
  size: z.string().describe('Size(s) read from labels, tags, rulers or packaging, e.g. "38-45", "M, L, XL", "30x40 cm", "350 ml". Empty string if no size can be seen'),
  size_source: z.enum(['label', 'estimate', 'none']).describe('label = read from text on the item; estimate = judged from the photo; none = unknown'),
  colors: z.array(z.string()),
  material: z.string(),
  brand: z.string().describe('Brand or model number if printed, else empty'),
  label_text: z.string().describe('Exact text read from labels/tags/boxes (keep Chinese characters as written), else empty'),
  price: z.number().nullable().describe('Price if a price tag is visible, else null'),
  currency: z.enum(['¥', '$', '']).describe('Currency of the visible price, else empty'),
  unit: z.enum(['pcs', 'pair', 'kg', 'box', 'carton', 'dozen', 'set', 'meter', 'roll', 'bag']).describe('Best selling unit for this kind of product'),
  confidence: z.number().describe('0 to 1 — how sure you are about the name')
})

function client(apiKey) {
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic()
}

// images: [{ data: base64, mediaType }]
async function scan(apiKey, images, lang) {
  if (!images || !images.length) throw Object.assign(new Error('No photo to scan'), { status: 400 })
  const language = LANG_NAME[lang] || 'English'
  const content = images.slice(0, 6).map(im => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType || 'image/jpeg', data: im.data } }))
  content.push({
    type: 'text',
    text: 'These photos show ONE product a trader found in a wholesale market (e.g. Yiwu). Identify it precisely.\n' +
      '- Read every visible label, tag, sticker, box print and size marking (Chinese and English) and use them.\n' +
      '- For size: prefer what is printed (shoe sizes, S/M/L, cm/mm dimensions, ml/L, weight). If nothing is printed, give a careful estimate only when a reference object makes it possible, and mark size_source accordingly.\n' +
      '- The name must be the exact trade name a wholesaler uses: material + type + use. Never a bare word like "cup", "bag" or "box".\n' +
      '  Examples: "Plastic ice cream cup", "Paper coffee cup", "Double wall paper cup", "PET cold drink cup", "Take-away juice cup", "Bubble tea cup", "Sauce cup" (small portion cup with lid),\n' +
      '  "Double cup holder" (carrier for 2 cups), "Cup lid", "Kraft paper bag", "Paper bag with handle", "Take-away food bag", "Kraft lunch box", "Pizza box", "Aluminium foil tray", "Wooden cutlery set", "Paper straw".\n' +
      '- Look closely at material (paper, kraft, PET, PP, PS, foam, aluminium), wall type, lid, handle and printing before naming.\n' +
      '- Write the name in ' + language + '.'
  })
  let res
  try {
    res = await client(apiKey).beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // If the model declines a photo, the API retries it on a fallback model in the same call
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { format: zodOutputFormat(Result), effort: 'medium' },
      messages: [{ role: 'user', content }]
    })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw Object.assign(new Error('The AI key is not valid. Check it in Settings → AI scanner.'), { status: 401 })
    if (e instanceof Anthropic.RateLimitError) throw Object.assign(new Error('The AI service is busy — try again in a moment.'), { status: 429 })
    if (e instanceof Anthropic.BadRequestError) throw Object.assign(new Error('The AI could not read this photo: ' + e.message), { status: 400 })
    if (e instanceof Anthropic.APIConnectionError) throw Object.assign(new Error('Could not reach the AI service. Check the internet connection of the computer.'), { status: 502 })
    if (e instanceof Anthropic.APIError) throw Object.assign(new Error('AI service error ' + (e.status || '') + ': ' + e.message), { status: 502 })
    if (/Could not resolve authentication|apiKey|API key/i.test(String(e && e.message))) throw Object.assign(new Error('The AI scanner is not set up. Add the key in Settings → AI scanner.'), { status: 400 })
    throw e
  }
  if (res.stop_reason === 'refusal') throw Object.assign(new Error('The AI declined to read this photo.'), { status: 422 })
  if (!res.parsed_output) throw Object.assign(new Error('The AI answer could not be read — try again.'), { status: 502 })
  return res.parsed_output
}

// Checks a key without spending anything (reads the model info)
async function check(apiKey) {
  try { await client(apiKey).models.retrieve(MODEL) }
  catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw Object.assign(new Error('This API key was refused by Claude. Copy it again from console.anthropic.com → API keys.'), { status: 400 })
    if (e instanceof Anthropic.APIConnectionError) throw Object.assign(new Error('Could not reach the AI service. Check the internet connection of the computer.'), { status: 502 })
    throw Object.assign(new Error('Could not check the key: ' + e.message), { status: 502 })
  }
}

module.exports = { scan, check, MODEL }
