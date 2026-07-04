// 递归删除 release/app/dist 下所有 sourcemap（上游缺失此 runner；renderer 的 map 在 js/ 子目录，需要递归）
const fs = require('fs')
const path = require('path')

function rmMaps(dir) {
  if (!fs.existsSync(dir)) return 0
  let n = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) n += rmMaps(p)
    else if (entry.name.endsWith('.map')) {
      fs.unlinkSync(p)
      n++
    }
  }
  return n
}

const deleted = rmMaps(path.resolve(__dirname, '../../release/app/dist'))
console.log(`deleted ${deleted} source map(s)`)
