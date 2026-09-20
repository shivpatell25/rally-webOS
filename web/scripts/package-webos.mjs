import { mkdir, readdir, rename, rm, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const channel = process.argv[2]
if (channel !== 'developer' && channel !== 'store') throw new Error('Packaging channel must be developer or store.')

const root = process.cwd()
const appInfo = JSON.parse(await readFile(resolve(root, 'dist/appinfo.json'), 'utf8'))
if (appInfo.id !== 'com.shiv.rally') throw new Error(`Unexpected app id: ${appInfo.id}`)
if (appInfo.resolution !== '1920x1080') throw new Error(`Unexpected resolution: ${appInfo.resolution}`)
if (appInfo.type !== 'web') throw new Error(`Unexpected app type: ${appInfo.type}`)

const output = resolve(root, 'packages', channel)
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

const executable = resolve(root, 'node_modules/.bin/ares-package')
const result = spawnSync(executable, ['dist', 'service', '-o', output], { cwd: root, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)

const generated = (await readdir(output)).filter((name) => name.endsWith('.ipk'))
if (generated.length !== 1) throw new Error(`Expected one IPK, found ${generated.length}.`)
const destination = `rally-webos-${channel}-${appInfo.version}.ipk`
await rename(resolve(output, generated[0]), resolve(output, destination))
console.log(resolve(output, destination))
