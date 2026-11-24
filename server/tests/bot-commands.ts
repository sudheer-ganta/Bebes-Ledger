import { hydrate } from '../../client/src/lib/hydrate'
import { runCommand } from '../src/bot/commands'

process.env.TZ = 'Asia/Kolkata'
let state = hydrate(null)
const now = new Date()
const say = (msg: string) => {
  const r = runCommand(state, msg, now)
  state = r.state
  console.log(`> ${msg}\n${r.reply}\n`)
}

for (const m of [
  '@help',
  '@spent 120 auto',          // before salary: no pool yet
  '@salary 25160',
  '@spent 120 auto',
  '250 movie with friends',
  'chai 20',
  '@veg 150 #groceries',
  '@water 500',
  '@glass',
  '@water 1',
  '@steps 3000',
  '@steps set 6000',
  '@walk',
  '@ate 3 eggs p20',
  '@task buy soap tomorrow',
  '@task pay recharge !',
  '@tasks',
  '@done soap',
  '@debt 2000',
  '@today',
  '@undo',
  'blah blah',
]) say(m)
