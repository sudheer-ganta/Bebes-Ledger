// npm run phone — builds the app and serves it on your Wi-Fi so a phone on the same network can open it.
import { execSync, spawn } from 'node:child_process'
import os from 'node:os'
import qrcode from 'qrcode-terminal'

const PORT = 4173

const addrs = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address)
const lan = addrs.find((a) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) ?? addrs[0]

if (!lan) {
  console.error('No Wi-Fi / LAN address found. Connect this computer to the same Wi-Fi as your phone and try again.')
  process.exit(1)
}

console.log('Building the app…')
execSync('npm --prefix client run build', { stdio: 'inherit' })

const url = `http://${lan}:${PORT}`
const server = spawn(
  'npm',
  ['--prefix', 'client', 'run', 'preview', '--', '--host', '0.0.0.0', '--port', String(PORT), '--strictPort'],
  { stdio: 'inherit', shell: true },
)

setTimeout(() => {
  console.log('\n────────────────────────────────────────────')
  console.log('  Life OS on your phone (same Wi-Fi):')
  console.log(`  ${url}`)
  console.log('────────────────────────────────────────────')
  qrcode.generate(url, { small: true })
  console.log('Scan the QR code with your phone camera, then use the browser menu → "Add to Home screen".')
  console.log('Stop with Ctrl+C.\n')
}, 2500)

const stop = () => {
  server.kill()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
