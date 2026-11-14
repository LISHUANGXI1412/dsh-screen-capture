import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export const name = 'screenshot'
export const inject = ['tools']

const SCRIPT = fileURLToPath(new URL('./capture.ps1', import.meta.url))
const SELECT_SCRIPT = fileURLToPath(new URL('./select.ps1', import.meta.url))
const DEFAULT_MAX_WIDTH = 1600
const CAPTURE_TIMEOUT_MS = 20000
const SELECT_TIMEOUT_MS = 130000
const DEFAULTS = { enabled: true, askBeforeCapture: true, lastRegion: null }

function normalizeRegion(value) {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.x)
  const y = Number(value.y)
  const width = Number(value.width)
  const height = Number(value.height)
  if (![x, y, width, height].every(Number.isFinite) || width < 4 || height < 4) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    at: Number.isFinite(Number(value.at)) ? Number(value.at) : 0,
  }
}

/** Apply a Remote(name) marker without TypeScript decorator support. */
function markRemoteMethod(serviceClass, method, exportName = method) {
  const instance = Object.create(serviceClass.prototype)
  const decorate = Remote(exportName)
  decorate(undefined, {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    addInitializer(fn) {
      fn.call(instance)
    },
  })
}

function settingsFile() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'screenshot', 'settings.json')
}

function readSettingsSync() {
  try {
    const file = settingsFile()
    if (!existsSync(file)) return { ...DEFAULTS }
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return {
      enabled: parsed.enabled !== false,
      askBeforeCapture: parsed.askBeforeCapture !== false,
      lastRegion: normalizeRegion(parsed.lastRegion),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

/** Accept both `{ options }` and the bare options object from the wire. */
function unwrap(value, key) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value)
    if (keys.length === 1 && keys[0] === key && value[key] && typeof value[key] === 'object') {
      return value[key]
    }
  }
  return value ?? {}
}

function runPowerShell(script, args, timeoutMs, signal, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', ...extraArgs, '-ExecutionPolicy', 'Bypass', '-File', script, ...args,
    ], { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`截图超时（${timeoutMs}ms）`))
    }, timeoutMs)

    const onAbort = () => child.kill()
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`无法启动 powershell.exe：${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr })
    })
  })
}

function lastJson(text) {
  const index = text.indexOf('{')
  if (index < 0) return undefined
  try {
    return JSON.parse(text.slice(index))
  } catch {
    return undefined
  }
}

/** Capture the screen to a PNG file and return its metadata. */
async function captureToFile(options = {}, signal) {
  if (process.platform !== 'win32') throw new Error('截图目前只支持 Windows')
  const target = String(options.target ?? 'screen')
  if (!['screen', 'window', 'region'].includes(target)) {
    throw new Error(`未知的 target "${target}"，只支持 screen / window / region`)
  }
  const maxWidth = Number.isFinite(Number(options.maxWidth)) && Number(options.maxWidth) > 0
    ? Math.floor(Number(options.maxWidth))
    : DEFAULT_MAX_WIDTH
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = options.path && String(options.path).trim()
    ? String(options.path).trim()
    : join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'screenshot', 'shots', `shot-${stamp}.png`)

  const cli = ['-Out', outPath, '-MaxWidth', String(maxWidth)]
  if (target === 'window') {
    cli.push('-Mode', 'window')
    if (options.window) cli.push('-Title', String(options.window))
  } else if (target === 'region') {
    if (!options.regionWidth || !options.regionHeight) {
      throw new Error('target="region" 需要 regionWidth 和 regionHeight 大于 0')
    }
    cli.push('-Mode', 'region',
      '-X', String(Math.round(options.regionX ?? 0)), '-Y', String(Math.round(options.regionY ?? 0)),
      '-W', String(Math.round(options.regionWidth)), '-H', String(Math.round(options.regionHeight)))
  } else {
    cli.push('-Mode', 'screen')
    if (typeof options.monitor === 'number' && options.monitor >= 0) {
      cli.push('-Monitor', String(Math.floor(options.monitor)))
    }
  }

  await mkdir(dirname(outPath), { recursive: true })
  const result = await runPowerShell(SCRIPT, cli, CAPTURE_TIMEOUT_MS, signal)
  const payload = lastJson(result.stdout)

  if (payload?.error === 'window-not-found') {
    const titles = Array.isArray(payload.titles) ? payload.titles : []
    throw new Error(`没找到标题包含 "${options.window}" 的窗口。当前可见窗口：\n${titles.map((t) => `- ${t}`).join('\n')}`)
  }
  if (result.code !== 0 || payload?.error) {
    const detail = payload?.error || result.stderr.trim() || result.stdout.trim()
    throw new Error(`截图失败：${detail}`)
  }
  if (!payload?.path) throw new Error('截图失败：没有拿到文件路径')

  return {
    path: payload.path,
    mode: payload.mode ?? target,
    width: payload.width,
    height: payload.height,
    sourceWidth: payload.sourceWidth ?? payload.width,
    sourceHeight: payload.sourceHeight ?? payload.height,
  }
}

/** Show the native full-screen selection overlay; returns the cropped PNG metadata or a cancel. */
async function pickRegionToFile(options = {}, signal) {
  if (process.platform !== 'win32') throw new Error('截图目前只支持 Windows')
  const maxWidth = Number.isFinite(Number(options.maxWidth)) && Number(options.maxWidth) > 0
    ? Math.floor(Number(options.maxWidth))
    : DEFAULT_MAX_WIDTH
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = options.path && String(options.path).trim()
    ? String(options.path).trim()
    : join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'screenshot', 'shots', `pick-${stamp}.png`)

  await mkdir(dirname(outPath), { recursive: true })
  const cli = ['-Out', outPath, '-MaxWidth', String(maxWidth), '-TimeoutSeconds', '120']
  if (options.autoRect) {
    const rect = normalizeRegion(options.autoRect)
    if (rect) cli.push('-AutoRect', `${rect.x},${rect.y},${rect.width},${rect.height}`)
  }
  if (options.hideWindow === true) {
    cli.push('-HideWindow')
    if (options.hideTitle) cli.push('-HideTitle', String(options.hideTitle))
  }
  const result = await runPowerShell(SELECT_SCRIPT, cli, SELECT_TIMEOUT_MS, signal, ['-Sta'])
  const payload = lastJson(result.stdout)
  if (payload?.cancelled) return { cancelled: true }
  if (payload?.error) throw new Error(`框选失败：${payload.error}`)
  if (!payload?.path) {
    throw new Error(`框选失败：${result.stderr.trim() || result.stdout.trim() || '选择器没有输出'}`)
  }
  return {
    cancelled: false,
    path: payload.path,
    width: payload.width,
    height: payload.height,
    sourceWidth: payload.sourceWidth ?? payload.width,
    sourceHeight: payload.sourceHeight ?? payload.height,
    x: payload.x,
    y: payload.y,
  }
}

async function routeAcceptsImages(ctx, exec) {  try {
    const routed = exec?.agent?.session?.requestHeader?.()?.config
    const provider = routed?.provider ?? exec?.agent?.options?.provider
    const model = routed?.model ?? exec?.agent?.options?.model
    const llm = ctx.get('llm')
    if (!provider || !model || !llm) return undefined
    const info = await llm.resolveModelInfo(provider, model, exec?.signal)
    if (!Array.isArray(info?.inputModalities)) return undefined
    return info.inputModalities.includes('image')
  } catch {
    return undefined
  }
}

/** Host half of the remote service the Settings page and the composer button call. */
export class ScreenshotRemoteService extends TypertRemoteService {
  static inject = []

  constructor(ctx, config = {}) {
    super(ctx, 'screenshot')
    this.host = config.host
  }

  /** Capture the screen and return the PNG as base64 for the browser to attach. */
  async capture(options) {
    const opts = unwrap(options, 'options')
    const result = await this.host.capture(opts)
    const data = await readFile(result.path)
    return {
      ok: true,
      base64: data.toString('base64'),
      mediaType: 'image/png',
      path: result.path,
      width: result.width,
      height: result.height,
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      mode: result.mode,
    }
  }

  /** Interactive drag-to-select on the whole desktop; returns the cropped PNG as base64. */
  async pickRegion(options) {
    const opts = unwrap(options, 'options')
    const result = await this.host.pickRegion(opts)
    if (result.cancelled) return { ok: false, cancelled: true }
    const data = await readFile(result.path)
    return {
      ok: true,
      cancelled: false,
      base64: data.toString('base64'),
      mediaType: 'image/png',
      path: result.path,
      width: result.width,
      height: result.height,
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      x: result.x,
      y: result.y,
    }
  }

  getSettings() {
    return { ok: true, ...this.host.settings }
  }
  async saveSettings(patch) {
    const next = unwrap(patch, 'settings')
    return { ok: true, ...(await this.host.saveSettings(next)) }
  }
}

markRemoteMethod(ScreenshotRemoteService, 'capture')
markRemoteMethod(ScreenshotRemoteService, 'pickRegion')
markRemoteMethod(ScreenshotRemoteService, 'getSettings')
markRemoteMethod(ScreenshotRemoteService, 'saveSettings')

export function apply(ctx, config = {}) {
  let settings = readSettingsSync()

  const host = {
    get settings() {
      return settings
    },
    capture: (options, signal) => captureToFile(options, signal),
    pickRegion: async (options = {}, signal) => {
      if (options.useLast && settings.lastRegion) {
        return pickRegionToFile({ ...options, autoRect: settings.lastRegion }, signal)
      }
      const result = await pickRegionToFile(options, signal)
      if (result && !result.cancelled && Number.isFinite(result.x)) {
        try {
          await host.saveSettings({
            lastRegion: {
              x: result.x,
              y: result.y,
              width: result.width,
              height: result.height,
              at: Date.now(),
            },
          })
        } catch {}
      }
      return result
    },
    async saveSettings(patch) {
      const next = {
        enabled: typeof patch?.enabled === 'boolean' ? patch.enabled : settings.enabled,
        askBeforeCapture: typeof patch?.askBeforeCapture === 'boolean'
          ? patch.askBeforeCapture
          : settings.askBeforeCapture,
        lastRegion: patch && 'lastRegion' in patch ? normalizeRegion(patch.lastRegion) : settings.lastRegion,
      }
      const file = settingsFile()
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify(next, null, 2), 'utf8')
      settings = next
      return next
    },
  }

  ctx.plugin(ScreenshotRemoteService, { host })

  // Hard gate: the model-facing tool follows the Settings switches on every call.
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== 'screenshot') return next()
    if (settings.enabled !== true) {
      return { kind: 'deny', reason: '截图工具已在 设置 → 截图 中关闭' }
    }
    if (settings.askBeforeCapture !== false) {
      return {
        kind: 'ask',
        reason: `模型请求截屏（${exec.arguments?.target ?? 'screen'}），需要你确认`,
        displayReason: exec.arguments?.window
          ? `是否允许截取窗口「${exec.arguments.window}」？`
          : '是否允许模型截取当前屏幕？',
      }
    }
    return next()
  })

  ctx.tools.register({
    name: 'screenshot',
    description:
      '截取当前 Windows 桌面并直接把图片给模型看（返回图片块，不需要再 read_image）。' +
      'target="screen"（默认，全部显示器）或指定 monitor；target="window" 按窗口标题子串截取某个窗口（省略 window 则截前台窗口）；' +
      'target="region" 用 regionX / regionY / regionWidth / regionHeight 截取屏幕坐标区域。' +
      '适用场景：用户说“看下我这个页面/窗口”、页面结构读不出来、原生程序界面。' +
      '**只在用户要求看屏幕时才调用；截图可能包含隐私内容，不要主动截。**' +
      '说明：截取的是屏幕上实际显示的内容，被别的窗口遮挡的部分拍不到；最小化的窗口要先还原。' +
      '用户在 设置 → 截图 里可以选择“截图前先询问”（默认开启）。',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: '截取范围：screen（默认，全部显示器）| window（按标题截窗口）| region（按坐标截区域）',
        },
        window: {
          type: 'string',
          description: 'target="window" 时的窗口标题（子串、不区分大小写）；省略则截前台窗口',
        },
        regionX: { type: 'number', description: 'target="region" 时的左上角 x（物理像素，虚拟桌面坐标）' },
        regionY: { type: 'number', description: 'target="region" 时的左上角 y' },
        regionWidth: { type: 'number', description: 'target="region" 时的宽度' },
        regionHeight: { type: 'number', description: 'target="region" 时的高度' },
        monitor: { type: 'number', description: 'target="screen" 且指定显示器时用，0 开始；默认 -1 表示全部显示器' },
        maxWidth: { type: 'number', description: '给模型看的图片最大宽度，默认 1600，0 表示不缩小' },
        path: { type: 'string', description: '可选：保存的 PNG 路径；省略则写到 DSH_HOME/screenshot/shots' },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          mode: { type: 'string' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          sourceWidth: { type: 'integer' },
          sourceHeight: { type: 'integer' },
          note: { type: 'string' },
          image: {
            type: 'object',
            properties: {
              attachmentId: { type: 'string' },
              mediaType: { type: 'string' },
              bytes: { type: 'integer' },
              width: { type: 'integer' },
              height: { type: 'integer' },
              name: { type: 'string' },
            },
          },
        },
        required: ['path', 'mode', 'width', 'height', 'sourceWidth', 'sourceHeight'],
      },
      render: (_args, value) => {
        const lines = [
          `<path>${value.path}</path>`,
          `<screenshot>${value.mode} 模式，${value.width}x${value.height} px`
            + (value.sourceWidth !== value.width ? `（原图 ${value.sourceWidth}x${value.sourceHeight} px）` : '')
            + `，${value.bytes ?? 0} bytes</screenshot>`,
        ]
        if (value.note) lines.push(value.note)
        const blocks = [{ type: 'text', text: lines.join('\n') }]
        if (value.image) blocks.push({ type: 'image', attachment: value.image })
        return blocks
      },
      presentationMeta: (_args, value) => ({ path: value.path }),
    },
    timeoutMs: CAPTURE_TIMEOUT_MS + 5000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (settings.enabled !== true) throw new Error('截图工具已在 设置 → 截图 中关闭')
      const result = await captureToFile(args, exec?.signal)
      const data = await readFile(result.path)
      const value = {
        path: result.path,
        mode: result.mode,
        width: result.width,
        height: result.height,
        sourceWidth: result.sourceWidth,
        sourceHeight: result.sourceHeight,
        bytes: data.byteLength,
      }

      const attachments = ctx.get('attachments')
      const accepts = await routeAcceptsImages(ctx, exec)
      if (!attachments) {
        value.note = '当前没有附件服务，图片已存到磁盘，可以用 read_image 打开这个路径。'
        return value
      }
      if (accepts === false) {
        value.note = '当前模型不支持图片输入，图片已存到磁盘，可以换支持图片的模型或用 read_image 打开。'
        return value
      }

      try {
        const ref = await attachments.saveImage({
          data,
          mediaType: 'image/png',
          name: `screenshot-${Date.now()}.png`,
        })
        value.image = {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...(ref.name ? { name: ref.name } : {}),
        }
      } catch (error) {
        value.note = `图片已保存，但附加到会话失败（${error.message}），可以用 read_image 打开 ${result.path}。`
      }
      return value
    },
  })
}
