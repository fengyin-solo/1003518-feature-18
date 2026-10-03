// 用 esbuild 把巡检回放数据层打成单例 ESM，供 verify-inspection-sync.mjs 在 Node 中验证。
import { build } from 'esbuild'
import { resolve } from 'node:path'

await build({
  entryPoints: ['scripts/test-barrel.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'scripts/dist-bundle/test-barrel.mjs',
  alias: { '@': resolve('src') },
})
console.log('测试 bundle 已生成：scripts/dist-bundle/test-barrel.mjs')
