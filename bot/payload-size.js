const net = require('node:net')
const port = Number(process.argv[2] || 8767)
const sock = net.connect(port, '127.0.0.1', () => {
  setTimeout(() => sock.write(JSON.stringify({ type: 'trigger', token: 'testtoken', target: 'Greatcat14', triggerAt: Date.now(), source: 'messung' }) + '\n'), 100)
})
let buf = ''
let total = 0
const t0 = Date.now()
sock.on('data', (d) => {
  buf += d.toString('utf8')
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (!line.trim()) continue
    const msg = JSON.parse(line)
    const bytes = Buffer.byteLength(line + '\n', 'utf8')
    total += bytes
    console.log(`  ${String(msg.type).padEnd(8)} ${String(bytes).padStart(6)} Bytes`)
    if (msg.type === 'result' || msg.type === 'error') {
      console.log(`  → gesamt: ${total} Bytes = ${(total / 1024).toFixed(2)} KiB   (Rundreise ${Date.now() - t0} ms)`)
      console.log(`  → bei 1 GB/Monat: ${Math.floor(1073741824 / total).toLocaleString('de-DE')} Scans/Monat`)
      sock.end(); process.exit(0)
    }
  }
})
setTimeout(() => { console.log('Timeout'); process.exit(1) }, 15000)
