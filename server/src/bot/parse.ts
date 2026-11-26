// Understanding everyday messages: amounts, typos, Hinglish, steps / water corrections, food and protein.
// Pure functions, no state: commands.ts decides what to do with what these find.

/** "120", "₹120", "rs120", "120rs", "1.2k", "1,200", "120/-" → number; anything else → null */
export function parseAmount(tok: string): number | null {
  const m = /^(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?(?:rs\.?|₹|inr|rupees|\/-)?$/i.exec(tok.trim())
  if (!m) return null
  const n = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1)
  return Number.isFinite(n) && n > 0 ? n : null
}

export const UNITS = new Set(['tray', 'trays', 'g', 'gm', 'gms', 'gram', 'grams', 'kg', 'kgs', 'ml', 'l', 'ltr', 'litre', 'litres', 'liter', 'liters', 'pc', 'pcs', 'piece', 'pieces', 'dozen', 'packet', 'packets', 'x', 'scoop', 'scoops', 'plate', 'plates', 'bowl', 'bowls', 'cup', 'cups', 'glass', 'glasses', 'bottle', 'bottles', 'km', 'kms', 'min', 'mins', 'minutes', 'hr', 'hrs', 'hour', 'hours', 'steps', 'step', 'eggs', 'egg', 'roti', 'rotis', 'idli', 'idlis', 'slices', 'slice'])

export const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, half: 0.5, couple: 2, ek: 1, do: 2, teen: 3, char: 4 }

/** Words that add nothing after "done": "done sir", "done ma ✅" */
export const POLITE = new Set(['sir', 'madam', 'maam', 'ma', 'mom', 'mum', 'mummy', 'mother', 'moira', 'bro', 'bhai', 'boss', 'darling', 'bebe', 'bébé', 'ji', 'ok', 'okay', 'yes', 'yeah', 'it', 'that', 'this', 'now', 'already', 'too', 'also', 'all', 'the', 'my', 'with', 'buying', 'bought', 'doing', 'did', 'finished', 'completed', 'is', 'was', 'hogaya', 'ho', 'gaya', 'kar', 'liya', 'diya', 'task', 'chore', 'number', 'no', 'item', 'todo'])

// ---------------------------------------------------------------- typos

// the words that decide what a message means; a typo in one of these used to turn "remov 1000 stpes" into ₹1,000
const KEY_WORDS = ['steps', 'remove', 'reduce', 'delete', 'subtract', 'minus', 'water', 'glass', 'glasses', 'bottle', 'litre', 'litres', 'eggs', 'protein', 'salary', 'paneer', 'chicken', 'walked', 'correct', 'actually', 'should', 'breakfast', 'dinner', 'expense', 'borrowed', 'omelette', 'banana', 'bananas']

// real words one letter away from a key word: never "fix" these ("later" is not "water", "mins" is not "minus")
const REAL_WORDS = new Set(['later', 'class', 'legs', 'battle', 'winner', 'mins', 'waiter', 'wafer', 'steep', 'stops', 'stop', 'step', 'reuse', 'remote', 'dinners', 'should', 'shoulder', 'sales', 'salad', 'banner', 'eggy', 'proteins', 'correction', 'expenses', 'remover', 'removed', 'deleted', 'reduced', 'walker', 'walks', 'walking', 'bottles', 'glassy', 'litres', 'stepped', 'chickens', 'actual'])

/** One missing or extra letter, two swapped letters ("stpes"), or (in words of 6+ letters) one wrong letter. */
export function nearly(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false
  if (REAL_WORDS.has(a) || REAL_WORDS.has(b)) return false
  if (a.length === b.length) {
    const diff = [...a].map((c, i) => (c === b[i] ? -1 : i)).filter((i) => i >= 0)
    // a single wrong letter in a short word is usually another real word ("class"/"glass"), so only for long ones
    if (diff.length === 1) return a.length >= 6
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true
  return false
}

const ALIASES: Record<string, string> = {
  stps: 'steps', stp: 'steps', setps: 'steps', stepz: 'steps', paani: 'water', pani: 'water', paanee: 'water', glas: 'glass', ltr: 'l', lit: 'l',
  remov: 'remove', rmv: 'remove', rem: 'remove', del: 'delete', dlt: 'delete', egss: 'eggs', egs: 'eggs', anda: 'egg', ande: 'eggs', omlet: 'omelette', omelet: 'omelette',
  doodh: 'milk', dudh: 'milk', chawal: 'rice', paneeer: 'paneer', chiken: 'chicken', chikken: 'chicken', sal: 'salary', salry: 'salary',
}

/** Lowercase, aliases, and typo-fix the words that matter. Keeps everything else as written. */
export function normalise(text: string): string {
  return text.toLowerCase().split(/\s+/).map((w) => {
    const m = /^([^a-z0-9]*)([a-z]+)([^a-z]*)$/.exec(w)
    if (!m) return w
    const [, pre, core, post] = m
    if (ALIASES[core]) return pre + ALIASES[core] + post
    if (KEY_WORDS.includes(core) || core.length < 4) return w
    const fix = KEY_WORDS.find((k) => nearly(core, k))
    return fix ? pre + fix + post : w
  }).join(' ')
}

// ---------------------------------------------------------------- corrections

export type Fix = { kind: 'add' | 'sub' | 'set' | 'clear' | 'undo'; n?: number; approx?: boolean }
// English and Hinglish ("steps kam karo 1000", "mere steps 5000 hai")
const SUB_WORDS = /\b(remove|removed|reduce|reduced|minus|delete|subtract|deduct|less|lesser|cut|wrongly|mistake|kam|ghatao|hatao|nikalo|nikal)\b|take (it )?(off|away)/
const ADD_WORDS = /\b(add|added|plus|more|another|again|aur|extra|jodo)\b|^\+/
// "my phone says 5800 steps", "steps today 4321": the phone's number is the total
const SET_WORDS = /\b(set|make|actually|only|correct|correction|wrong|should be|total|are|is|was|it'?s|its|not|galat|hai|tha|sahi|change|update|fix|says|shows|showing|counter|count|tracker|phone|watch|app)\b|[=:]|\bsteps? today\s*:?\s*\d|\btoday'?s steps\b/
const CLEAR_WORDS = /\b(reset|clear|zero|erase|wipe)\b/
const UNDO_WORDS = /\b(undo|revert)\b|\bremove (the )?last\b|\bdelete (the )?last\b/
const ASK = /^(can|could|would|will) (you|u)\b|^please\b|^pls\b|^plz\b/

/** Numbers in a message with what follows each ("3 km", "500ml"), skipping times like "10 pm". */
function numbersIn(lower: string): Array<{ n: number; next: string; prev: string; i: number }> {
  // "1,000" stays one number; "5000, its 4000" splits
  const toks = lower.replace(/(\d)\s*(ml|l|km|kms|min|mins|k)\b/g, '$1$2').replace(/,(?!\d{3}\b)|[?!]+/g, ' ').split(/\s+/).filter(Boolean)
  const out: Array<{ n: number; next: string; prev: string; i: number }> = []
  toks.forEach((t, i) => {
    const unit = /^[-+]?(\d[\d,]*(?:\.\d+)?)(km|kms|min|mins)$/.exec(t)
    if (unit) { out.push({ n: Number(unit[1].replace(/,/g, '')), next: unit[2].startsWith('km') ? 'km' : 'min', prev: toks[i - 1] ?? '', i }); return }
    const n = parseAmount(t.replace(/^[-+]/, ''))
    if (n !== null && !/^(am|pm)$/.test(toks[i + 1] ?? '')) out.push({ n, next: toks[i + 1] ?? '', prev: toks[i - 1] ?? '', i })
  })
  return out
}

/**
 * Steps in plain words: "remove 1000 steps", "my steps are 5000", "steps -500", "walked 2k", "walked 3 km",
 * "change steps from 6065 to 5000", "not 6065, its 4000", "steps kam karo 1000", "reset steps".
 */
export function parseStepsFix(raw: string): Fix | null {
  const lower = normalise(raw)
  // "walked 2k", "walked 3 km", "walked for 30 mins": yes. "i walked 2 dogs": no
  const aboutSteps = /\b(steps?|paces|kadam)\b/.test(lower) ||
    /\bwalked\s+(?:for\s+)?(?:\d[\d,]*k\b|\d{3,}[\d,]*\b(?!\s*[a-z])|\d+(?:\.\d+)?\s*(?:km|kms|kilomet\w*|mins?|minutes?|hours?|hrs?)\b)/.test(lower)
  if (!aboutSteps) return null
  const nums = numbersIn(lower)
  const neg = /(?:^|\s)-\s?\d/.test(lower)
  if (!nums.length) {
    if (CLEAR_WORDS.test(lower)) return { kind: 'clear' }
    if (UNDO_WORDS.test(lower) || /\b(remove|delete)\b/.test(lower)) return { kind: 'undo' }
    return null
  }
  // distance and time walked → steps (about 1,300 a km, 100 a minute)
  const toSteps = (x: { n: number; next: string }) =>
    x.next === 'km' || /^(km|kms|kilometers?|kilometres?)$/.test(x.next) ? { n: Math.round(x.n * 1300), approx: true }
    : x.next === 'min' || /^(mins?|minutes?)$/.test(x.next) ? { n: Math.round(x.n * 100), approx: true }
    : /^(hrs?|hours?)$/.test(x.next) ? { n: Math.round(x.n * 6000), approx: true }
    : { n: x.n, approx: false }
  // "from 6065 to 5000", "6065 to 5000": the number after "to" is the right one
  const to = nums.find((x) => x.prev === 'to' || x.prev === 'into')
  // "5000 not 6065", "not 6065 its 4000": skip the number that was called wrong
  const good = nums.filter((x) => x.prev !== 'not' && x.prev !== 'from' && x.prev !== 'of' && x.prev !== 'instead')
  const pick = to ?? good.at(-1) ?? nums.at(-1)!
  const first = toSteps(good[0] ?? nums[0])
  if (first.n > 100000) return null
  if (to) return { kind: 'set', ...toSteps(to) }
  if (neg || SUB_WORDS.test(lower)) return { kind: 'sub', ...first }
  if (ADD_WORDS.test(lower)) return { kind: 'add', ...first }
  if (SET_WORDS.test(lower)) return { kind: 'set', ...toSteps(pick) }
  return { kind: 'add', ...first }
}

const DRINK_VERB = /\b(drank|drink|drinking|had|have|piya|pi liya|pee liya|sipped|finished)\b/
/**
 * Water in plain words: "drank 2 glasses", "a bottle of water", "remove 500ml water", "water is 1.5l actually",
 * "drank water" (a glass), "pani piya", "water kam karo 500", "undo water". Not milk, chai, a water bottle bought for ₹20.
 */
export function parseWaterFix(raw: string): Fix | null {
  let t = normalise(raw).replace(/(\d)\s*(ml|l|ltr|litres?|liters?)\b/g, '$1$2')
  // the old shorthand: "drank 2" (litres), "drink 500" (mL)
  if (/^(drank|drink|w)\s+\d+(\.\d+)?$/.test(t)) t = t.replace(/^(drank|drink|w)/, 'water')
  if (!/\b(water|glass(es)?|bottles?)\b|\d(ml|l|ltr|litres?|liters?)\b/.test(t)) return null
  if (/\b(beer|wine|juice|milk|coke|soda|chai|tea|coffee|lassi|buttermilk|chaas|shake|whey|protein|daaru|alcohol)\b/.test(t)) return null
  if (/₹|\brs\.?\s*\d|\d\s*rs\b|\b(bought|buy|paid|spent|cost|costs|price)\b/.test(t)) return null
  // a water can / jar / bisleri is a purchase; a spilled or broken glass was not drunk
  if (/\b(can|cans|jar|jars|tanker|bisleri|kinley|aquafina|purifier|filter|bill|bottle of [a-z]+ \d)\b/.test(t) && !/\b(drank|drink|piya)\b/.test(t)) return null
  if (/\b(spill\w*|broke|broken|break|wash\w*|clean\w*|fill\w*|lost|drop\w*|cold|hot|warm|taste\w*|weird|dirty|smell\w*)\b/.test(t)) return null
  // a glass or bottle on its own only counts with a count, "water", or a drink verb ("glass broke" is not water)
  if (/\b(glass|bottle)\b/.test(t) && !/\bwater\b/.test(t) && !DRINK_VERB.test(t) &&
    !/^\s*(?:(?:remove|minus|delete|undo|less|kam|plus|add|another)\s+)?(\d+(\.\d+)?|a|an|one|two|three|half|ek|do)\s+(big\s+|small\s+|full\s+|more\s+)?(glass|bottle)/.test(t)) return null
  let ml: number | null = null
  let approx = false
  const unit = /(\d+(?:\.\d+)?)(ml|l|ltr|litres?|liters?)\b/.exec(t)
  if (unit) ml = Number(unit[1]) * (unit[2] === 'ml' ? 1 : 1000)
  else {
    const count = /\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|half|ek|do|teen)\s+(?:big\s+|small\s+|full\s+|more\s+)?(glass(?:es)?|bottles?)\b/.exec(t)
    if (count) ml = (/^\d/.test(count[1]) ? Number(count[1]) : NUMBER_WORDS[count[1]]) * (count[2].startsWith('glass') ? 250 : 1000)
    else if (/\b(glass|bottle)\b/.test(t) && !/\d/.test(t)) ml = /\bbottle\b/.test(t) ? 1000 : 250
    // "water bottle 20" with no count before "bottle" is a purchase, not 20 mL
    else if ((/^(?:i\s+)?(?:water|w|drank|drink|had)\b/.test(t) || /\bwater\b/.test(t)) && !/\b(glass(es)?|bottles?)\b/.test(t)) {
      // "water 500" (mL), "water 2" (litres), "water kam karo 500"
      const bare = /(?:^|\s)[-+]?(\d+(?:\.\d+)?)\b/.exec(t)
      if (bare) ml = Number(bare[1]) <= 10 ? Number(bare[1]) * 1000 : Number(bare[1])
    }
  }
  if (ml === null) {
    if (CLEAR_WORDS.test(t)) return { kind: 'clear' }
    if (UNDO_WORDS.test(t) || /\b(remove|delete)\b/.test(t)) return { kind: 'undo' }
    // "drank water", "pani piya": a glass
    if (DRINK_VERB.test(t) && /\bwater\b/.test(t) && !/\b(not|didn'?t|no)\b/.test(t)) return { kind: 'add', n: 250, approx: true }
    return null
  }
  if (!(ml > 0) || ml > 10000) return null
  if (/(?:^|\s)-\s?\d/.test(t) || SUB_WORDS.test(t)) return { kind: 'sub', n: ml, approx }
  if (ADD_WORDS.test(t)) return { kind: 'add', n: ml, approx }
  if (SET_WORDS.test(t)) return { kind: 'set', n: ml, approx }
  return { kind: 'add', n: ml, approx }
}

/** "can you make my steps 5000" is a request, not a question. */
export const isRequest = (lower: string) => ASK.test(lower)

// ---------------------------------------------------------------- food

// grams of protein per piece / bowl / glass, typical Indian portions (matches the Gemini log_meal hints)
const PER_PIECE: Array<[RegExp, number]> = [
  [/^eggwhites?$/, 3.5], [/^eggs?$/, 6], [/^omelet+e?s?$/, 12], [/^bhurji$/, 0], [/^(milk|glass)$/, 8], [/^paneer$/, 15], [/^(chicken|fish|mutton|prawns?)$/, 25],
  [/^(dal|daal|sambar|rajma|chole|chana|chickpeas?)$/, 9], [/^(curd|dahi|yogurt|yoghurt|raita)$/, 6], [/^oats$/, 6.5], [/^(roti|rotis|chapati|chapatis|chapathi|chapathis|phulka|paratha|parathas)$/, 3],
  [/^rice$/, 4], [/^(bread|toast|slices?)$/, 3], [/^(sprouts)$/, 7], [/^(soya|soyabean|chunks)$/, 15], [/^(peanuts?|almonds?|nuts|cashews?)$/, 5], [/^peanut ?butter$/, 7],
  [/^(dosa|dosas|idli|idlis|upma|poha|uttapam|vada|vadas)$/, 3], [/^(whey|shake|scoop)$/, 24], [/^(tofu)$/, 10], [/^(lassi|buttermilk|chaas)$/, 4],
  [/^(bananas?|apples?|fruits?|oranges?|chai|tea|coffee|biscuits?|cookies?|chutney|salad|veggies|vegetables|juice)$/, 1],
]
// per 100 g when a weight is given ("chicken 200g", "150 g paneer")
const PER_100G: Array<[RegExp, number]> = [
  [/^(chicken|mutton)$/, 25], [/^(fish|prawns?)$/, 22], [/^paneer$/, 18], [/^(soya|soyabean|chunks)$/, 52], [/^oats$/, 13], [/^(curd|dahi|yogurt|yoghurt)$/, 4],
  [/^rice$/, 2.7], [/^(dal|daal|rajma|chole|chana)$/, 7], [/^(peanuts?)$/, 25], [/^(almonds?)$/, 21], [/^(whey)$/, 80], [/^(sprouts)$/, 8], [/^tofu$/, 8], [/^milk$/, 3.4],
]
// words that only describe a dish or a portion
const MEAL_FILLER = new Set(['i', 'just', 'ate', 'eat', 'had', 'have', 'eaten', 'drank', 'drink', 'and', 'with', 'of', 'a', 'an', 'some', 'at', 'for', 'in', 'my', 'the', 'glass', 'glasses', 'cup', 'cups', 'bowl', 'bowls', 'plate', 'plates', 'piece', 'pieces', 'scoops', 'half', 'full', 'big', 'small', 'large', 'boiled', 'fried', 'scrambled', 'grilled', 'roasted', 'home', 'made', 'homemade', 'breakfast', 'lunch', 'dinner', 'snack', 'snacks', 'brunch', 'today', 'morning', 'evening', 'night', 'now', 'also', 'too', 'pg', 'protein', 'curry', 'gravy', 'fry', 'masala', 'sabzi', 'sabji', 'bhurji', 'tikka', 'g', 'gm', 'gms', 'grams', 'ml', 'kg', 'post', 'pre', 'workout', 'aur', 'khaya', 'khaye', 'liya', 'white', 'whites'])

function foodWords(text: string): string[] {
  return normalise(text).replace(/\begg whites?\b/g, 'eggwhites').replace(/\bpeanut butter\b/g, 'peanutbutter').replace(/(\d)\s*(g|gm|gms|grams|ml)\b/g, '$1$2').replace(/[^a-z0-9.\s]/g, ' ').split(/\s+/).filter(Boolean)
}
const findIn = (table: Array<[RegExp, number]>, w: string) => table.find(([re]) => re.test(w.replace(/^peanutbutter$/, 'peanut butter')))?.[1]

/** Rough protein: "two eggs drank half glass milk" = 2×6 + 0.5×8 = 16 g; "chicken 200g" = 50 g. 0 when nothing is recognised. */
export function estimateProtein(text: string): number {
  const ws = foodWords(text)
  let total = 0
  let qty: number | null = null
  let grams: number | null = null
  let last: { per100?: number; counted: number } | null = null
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]
    const g = /^(\d+(?:\.\d+)?)(g|gm|gms|grams|ml)$/.exec(w)
    if (g) {
      // "chicken 200g": a weight after the food re-prices it per 100 g
      if (last?.per100 !== undefined && last.counted >= 0 && qty === null && grams === null && i > 0) { total += last.per100 * Number(g[1]) / 100 - last.counted; last = null; continue }
      grams = Number(g[1])
      continue
    }
    const n = /^\d+(\.\d+)?$/.test(w) ? Number(w) : NUMBER_WORDS[w]
    if (n !== undefined) { qty = w === 'half' && qty ? qty * 0.5 : n; continue }
    const piece = findIn(PER_PIECE, w)
    // "glass" only counts on its own when no milk follows ("half glass milk" counts milk once)
    if (piece !== undefined && !(w === 'glass' && ws.slice(i + 1, i + 3).includes('milk')) && !(w === 'scoop' && ws.slice(i - 2, i + 3).some((x) => /^(whey|shake)$/.test(x)))) {
      const per100 = findIn(PER_100G, w)
      const add = grams !== null && per100 !== undefined ? per100 * grams / 100 : piece * (qty ?? 1)
      total += add
      last = { per100, counted: add }
      qty = null
      grams = null
    }
  }
  return Math.round(total)
}

/** Food words the estimator doesn't know ("biryani", "maggi"), so a smarter guess (Gemini) is worth asking for. */
export function unknownFoods(text: string): string[] {
  return foodWords(text).filter((w) =>
    !MEAL_FILLER.has(w) && !(w in NUMBER_WORDS) && !/^[\d.]+$/.test(w) && !/^p\d+$/.test(w) && !/^\d+(\.\d+)?(g|gm|gms|grams|ml)$/.test(w) &&
    findIn(PER_PIECE, w) === undefined)
}

/** "two eggs drank half glass milk" → "two eggs, half glass milk" */
export function mealTitle(words: string[]): string {
  return words.join(' ').split(/\s*(?:,|\band\b|\bdrank\b|\bdrink\b|\bhad\b|\bate\b|\bwith\b|\+|&)\s*/i).map((p) => p.trim()).filter(Boolean).join(', ')
}
