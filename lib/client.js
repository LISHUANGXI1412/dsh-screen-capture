window.__ModuleLoader__.load({
  id: 'dsh-screen-capture',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState, useCallback } = React

    const EN = {
      label: 'Screenshot',
      button: 'Screenshot',
      buttonHint: 'Insert a screenshot into the composer',
      cropHint: 'Drag to select a region · click for full screen · Esc to cancel',
      menuTitle: 'Screenshot options',
      menuRegion: 'Select a region',
      menuHidden: 'Hide this window, then select',
      menuFull: 'Capture the whole screen',
      menuLast: 'Capture last selection',
      noteModelOnly: 'The two switches only affect screenshots the model asks for. The composer camera button and Ctrl+Shift+S never prompt.',
      shortcutHint: 'Shortcut: Ctrl+Shift+S (while this window is focused) starts a region capture.',
      lastRegion: 'Last selection',
      none: 'none',
      clear: 'Clear',
      capturing: 'Capturing…',
      failed: 'Capture failed',
      noComposer: 'No composer is focused',
      settingsTitle: 'Screenshot',
      settingsSubtitle: 'Capture the screen and put the image into the composer. Local only; nothing is uploaded.',
      enableTool: 'Allow the model to take screenshots',
      enableToolHint: 'Adds a screenshot tool the agent can call.',
      ask: 'Ask before every capture',
      askHint: 'Hard gate: when on, the agent must ask you before any screenshot.',
      saved: 'Saved',
      saving: 'Saving…',
      loadFailed: 'Could not load settings',
      on: 'On',
      off: 'Off',
    }

    const ZH = {
      label: '截图',
      button: '截图',
      buttonHint: '截屏并插入输入框',
      cropHint: '拖动鼠标框选区域；单击截全屏；Esc 取消',
      menuTitle: '截图选项',
      menuRegion: '框选截图',
      menuHidden: '隐藏窗口后框选',
      menuFull: '截取整个屏幕',
      menuLast: '按上次选区截图',
      noteModelOnly: '这两个开关只影响模型发起的截图；输入框的相机按钮和 Ctrl+Shift+S 不弹询问。',
      shortcutHint: '快捷键：窗口聚焦时按 Ctrl+Shift+S 直接开始框选截图。',
      lastRegion: '上次选区',
      none: '无',
      clear: '清除',
      capturing: '截图中…',
      failed: '截图失败',
      noComposer: '没有找到输入框',
      settingsTitle: '截图',
      settingsSubtitle: '截屏后直接插入输入框。只在本机处理，不会上传到别处。',
      enableTool: '允许模型自己截屏',
      enableToolHint: '勾选后模型会得到截图工具。',
      ask: '截图前先询问',
      askHint: '硬约束：开启后，模型每次截屏都要先得到你的同意。',
      saved: '已保存',
      saving: '保存中…',
      loadFailed: '读取设置失败',
      on: '开',
      off: '关',
    }

    function makeT(ctx) {
      try {
        ctx.locale.register('screenshot', { en: EN, zh: ZH })
      } catch {}
      let bound
      try {
        bound = ctx.locale.bind('screenshot')
      } catch {}
      return function t(key, fallback) {
        try {
          if (typeof bound === 'function') {
            const value = bound(key)
            if (typeof value === 'string' && value) return value
          } else if (bound && typeof bound[key] === 'string') {
            return bound[key]
          }
        } catch {}
        let id = 'en'
        try { id = ctx.locale.getLocale().id } catch {}
        const dict = id === 'zh' ? ZH : EN
        return dict[key] || fallback || key
      }
    }

    function makeApi(ctx) {
      function call(method, args) {
        return ctx.connection.rpc.call('/api', 'screenshot/' + method, { args: args || {} }, undefined)
          .then(function (response) {
            if (response && response.ok) return response.value
            const message = response && response.error ? response.error.message : 'screenshot remote call failed'
            const error = new Error(message)
            error.code = response && response.error ? response.error.code : 'REMOTE_FAILED'
            throw error
          })
      }
      return {
        capture: function (options) { return call('capture', { options: options || {} }) },
        pickRegion: function (options) { return call('pickRegion', { options: options || {} }) },
        getSettings: function () { return call('getSettings', {}) },
        saveSettings: function (patch) { return call('saveSettings', { patch: patch || {} }) },
      }
    }

    function base64ToBytes(base64) {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return bytes
    }

    function report(message) {
      try { console.error('[dsh-screen-capture]', message) } catch {}
      try {
        const el = document.createElement('div')
        el.textContent = '[截图] ' + message
        el.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:2147483647;'
          + 'max-width:74vw;padding:8px 12px;border-radius:8px;background:#b3261e;color:#fff;'
          + 'font-size:12px;line-height:1.55;box-shadow:0 6px 20px rgba(0,0,0,.35);white-space:pre-wrap'
        document.body.appendChild(el)
        window.setTimeout(() => { el.remove() }, 20000)
      } catch {}
    }

    function diagnostics(ctx) {
      try {
        const connection = ctx.connection
        const rpc = connection && connection.rpc
        return 'connection=' + (typeof connection)
          + ' rpc=' + (typeof rpc)
          + ' call=' + (rpc ? typeof rpc.call : 'n/a')
      } catch (error) {
        return 'diagnostics failed: ' + (error && error.message ? error.message : String(error))
      }
    }


    function insertIntoComposer(file) {
      const seat = document.querySelector('[data-conversation-region="composer"]') || document
      const input = seat.querySelector('input[type="file"]')
      if (input) {
        try {
          const transfer = new DataTransfer()
          transfer.items.add(file)
          input.files = transfer.files
          input.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        } catch {}
      }
      const editor = seat.querySelector('[contenteditable="true"]')
      if (editor) {
        try {
          const transfer = new DataTransfer()
          transfer.items.add(file)
          editor.focus()
          editor.dispatchEvent(new ClipboardEvent('paste', {
            clipboardData: transfer,
            bubbles: true,
            cancelable: true,
          }))
          return true
        } catch {}
      }
      return false
    }

    function CameraIcon(props) {
      return h('svg', {
        width: props.size || 16,
        height: props.size || 16,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, [
        h('path', { key: 'b', d: 'M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z' }),
        h('circle', { key: 'c', cx: 12, cy: 13, r: 3.2 }),
      ])
    }

    return {
      inject: ['slots', 'connection', 'locale'],
      apply(ctx) {
        const t = makeT(ctx)
        const shot = makeApi(ctx)

        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-screen-capture'
        style.textContent = '@keyframes shot-spin { to { transform: rotate(360deg); } }'
        document.head.appendChild(style)
        ctx.effect(function () {
          return function () { style.remove() }
        })

        function openCrop(result) {
          const root = document.createElement('div')
          root.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:crosshair;user-select:none;overflow:hidden;background:transparent'

          const img = document.createElement('img')
          img.style.cssText = 'position:absolute;pointer-events:none;user-select:none'
          img.src = 'data:image/png;base64,' + result.base64

          const dim = document.createElement('div')
          dim.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.45);pointer-events:none'

          const hint = document.createElement('div')
          hint.textContent = t('cropHint')
          hint.style.cssText = 'position:absolute;left:50%;top:16px;transform:translateX(-50%);padding:6px 12px;'
            + 'border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;pointer-events:none;white-space:nowrap'

          root.append(img, dim, hint)
          document.body.appendChild(root)

          const vw = window.innerWidth
          const vh = window.innerHeight
          let sw = result.width
          let sh = result.height
          let scale = 1
          let disp = { x: 0, y: 0 }

          function layout() {
            sw = img.naturalWidth || result.width
            sh = img.naturalHeight || result.height
            scale = Math.min(vw / sw, vh / sh)
            const w = sw * scale
            const h = sh * scale
            disp = { x: (vw - w) / 2, y: (vh - h) / 2 }
            img.style.left = disp.x + 'px'
            img.style.top = disp.y + 'px'
            img.style.width = w + 'px'
            img.style.height = h + 'px'
          }

          let box = null
          let start = null
          let dragging = false
          let done = false

          function close() {
            if (done) return
            done = true
            root.remove()
            document.removeEventListener('keydown', onKey, true)
            window.removeEventListener('resize', layout)
          }

          function onKey(event) {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              close()
            }
          }

          function commit(sel) {
            if (done) return
            if (!img.complete || !img.naturalWidth) {
              img.addEventListener('load', () => commit(sel), { once: true })
              img.addEventListener('error', () => {
                close()
                report(t('failed') + '：截图解码失败')
              }, { once: true })
              return
            }
            close()
            const useSel = sel && sel.w >= 6 && sel.h >= 6 ? sel : null
            let sx = 0
            let sy = 0
            let cw = sw
            let ch = sh
            if (useSel) {
              sx = Math.round((useSel.x - disp.x) / scale)
              sy = Math.round((useSel.y - disp.y) / scale)
              cw = Math.round(useSel.w / scale)
              ch = Math.round(useSel.h / scale)
              sx = Math.max(0, Math.min(sw - 1, sx))
              sy = Math.max(0, Math.min(sh - 1, sy))
              cw = Math.max(1, Math.min(sw - sx, cw))
              ch = Math.max(1, Math.min(sh - sy, ch))
            }

            const canvas = document.createElement('canvas')
            canvas.width = cw
            canvas.height = ch
            try {
              canvas.getContext('2d').drawImage(img, sx, sy, cw, ch, 0, 0, cw, ch)
            } catch (error) {
              report(t('failed') + '：裁剪失败 ' + (error && error.message ? error.message : String(error)))
              return
            }

            let out = canvas
            const limit = 1600
            if (cw > limit) {
              const ratio = limit / cw
              const scaled = document.createElement('canvas')
              scaled.width = limit
              scaled.height = Math.max(1, Math.round(ch * ratio))
              scaled.getContext('2d').drawImage(canvas, 0, 0, scaled.width, scaled.height)
              out = scaled
            }

            out.toBlob((blob) => {
              if (!blob) {
                report(t('failed') + '：toBlob 返回空')
                return
              }
              const file = new File([blob], 'screenshot-' + Date.now() + '.png', { type: 'image/png' })
              if (!insertIntoComposer(file)) report(t('noComposer'))
            }, 'image/png')
          }

          function point(event) {
            return { x: event.clientX, y: event.clientY }
          }

          function onDown(event) {
            if (done || event.button !== 0) return
            event.preventDefault()
            start = point(event)
            dragging = true
            dim.remove()
            if (!box) {
              box = document.createElement('div')
              box.style.cssText = 'position:absolute;border:1px solid #4aa3ff;background:rgba(74,163,255,.12);'
                + 'box-shadow:0 0 0 100vmax rgba(0,0,0,.45);pointer-events:none'
              root.appendChild(box)
            }
            if (root.setPointerCapture) root.setPointerCapture(event.pointerId)
          }

          function onMove(event) {
            if (!dragging || !box) return
            const p = point(event)
            const x = Math.min(start.x, p.x)
            const y = Math.min(start.y, p.y)
            const w = Math.abs(p.x - start.x)
            const h = Math.abs(p.y - start.y)
            box.style.left = x + 'px'
            box.style.top = y + 'px'
            box.style.width = w + 'px'
            box.style.height = h + 'px'
          }

          function onUp(event) {
            if (!dragging) return
            dragging = false
            const p = point(event)
            const x = Math.min(start.x, p.x)
            const y = Math.min(start.y, p.y)
            const w = Math.abs(p.x - start.x)
            const h = Math.abs(p.y - start.y)
            if (w < 6 || h < 6) commit(null)
            else commit({ x, y, w, h })
          }

          root.addEventListener('pointerdown', onDown)
          root.addEventListener('pointermove', onMove)
          root.addEventListener('pointerup', onUp)
          root.addEventListener('pointercancel', () => { dragging = false })

          document.addEventListener('keydown', onKey, true)
          window.addEventListener('resize', layout)
          img.addEventListener('load', layout)
          layout()
        }

        function insertBase64Shot(result) {
          const bytes = base64ToBytes(result.base64)
          const file = new File([bytes], 'screenshot-' + Date.now() + '.png', { type: 'image/png' })
          if (!insertIntoComposer(file)) report(t('noComposer'))
        }

        let menuEl = null
        let menuCleanup = null
        function closeShotMenu() {
          if (menuEl) { menuEl.remove(); menuEl = null }
          if (menuCleanup) { menuCleanup(); menuCleanup = null }
        }

        function openShotMenu(anchor, items) {
          closeShotMenu()
          const rect = anchor.getBoundingClientRect()
          const menu = document.createElement('div')
          menu.style.cssText = 'position:fixed;z-index:2147483647;min-width:196px;padding:4px;border-radius:10px;'
            + 'background:rgba(28,28,30,.97);color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.4);font-size:12.5px;'
            + 'left:' + Math.max(8, Math.min(rect.left, window.innerWidth - 208)) + 'px;'
            + 'bottom:' + (window.innerHeight - rect.top + 8) + 'px'
          for (const item of items) {
            const button = document.createElement('button')
            button.type = 'button'
            button.textContent = item.label
            button.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;border:none;'
              + 'border-radius:7px;background:transparent;color:inherit;cursor:pointer;font-size:12.5px'
            button.addEventListener('mouseenter', () => { button.style.background = 'rgba(255,255,255,.12)' })
            button.addEventListener('mouseleave', () => { button.style.background = 'transparent' })
            button.addEventListener('click', () => { closeShotMenu(); item.run() })
            menu.appendChild(button)
          }
          document.body.appendChild(menu)
          menuEl = menu
          const onDown = (event) => { if (!menu.contains(event.target)) closeShotMenu() }
          const onKey = (event) => { if (event.key === 'Escape') closeShotMenu() }
          const timer = window.setTimeout(() => {
            document.addEventListener('pointerdown', onDown, true)
            document.addEventListener('keydown', onKey, true)
          }, 0)
          menuCleanup = () => {
            window.clearTimeout(timer)
            document.removeEventListener('pointerdown', onDown, true)
            document.removeEventListener('keydown', onKey, true)
          }
        }

        let shotBusy = false
        async function performShot(mode) {
          if (shotBusy) return
          shotBusy = true
          try {
            if (mode === 'full') {
              const full = await shot.capture({ target: 'screen', maxWidth: 1600 })
              insertBase64Shot(full)
              return
            }
            const result = await shot.pickRegion({
              maxWidth: 1600,
              hideWindow: mode === 'hidden',
              hideTitle: mode === 'hidden' ? (document.title || '') : '',
              useLast: mode === 'last',
            })
            if (!result || result.cancelled) return
            insertBase64Shot(result)
          } catch (caught) {
            const message = caught && caught.message ? caught.message : String(caught)
            report(t('failed') + '：' + message + '\n' + diagnostics(ctx))
            if (mode === 'region' || mode === 'hidden') {
              try {
                const fallback = await shot.capture({ target: 'screen', maxWidth: 99999 })
                openCrop(fallback)
              } catch (again) {
                report(t('failed') + '：' + (again && again.message ? again.message : String(again)))
              }
            }
          } finally {
            shotBusy = false
          }
        }

        function ShotButton() {
          const [busy, setBusy] = useState(false)

          async function run(mode) {
            setBusy(true)
            try {
              await performShot(mode)
            } finally {
              setBusy(false)
            }
          }

          const baseStyle = {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 28,
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.55 : 0.85,
          }

          return h('span', { style: { display: 'inline-flex', alignItems: 'center' } }, [
            h('button', {
              key: 'main',
              type: 'button',
              title: busy ? t('capturing') : t('buttonHint'),
              'aria-label': t('button'),
              disabled: busy,
              onClick: () => run('region'),
              style: { ...baseStyle, width: 26, borderRadius: 7 },
            }, busy ? h('span', {
              style: {
                width: 13, height: 13, borderRadius: '50%',
                border: '2px solid currentColor', borderTopColor: 'transparent',
                animation: 'shot-spin .8s linear infinite',
              },
            }) : CameraIcon({ size: 16 })),
            h('button', {
              key: 'more',
              type: 'button',
              title: t('menuTitle'),
              'aria-label': t('menuTitle'),
              disabled: busy,
              onClick: async (event) => {
                event.stopPropagation()
                const anchor = event.currentTarget
                let settings = null
                try { settings = await shot.getSettings() } catch {}
                const items = [
                  { label: t('menuRegion'), run: () => run('region') },
                  { label: t('menuHidden'), run: () => run('hidden') },
                ]
                if (settings && settings.lastRegion) {
                  const region = settings.lastRegion
                  items.push({
                    label: t('menuLast') + ' (' + region.width + 'x' + region.height + ')',
                    run: () => run('last'),
                  })
                }
                items.push({ label: t('menuFull'), run: () => run('full') })
                openShotMenu(anchor, items)
              },
              style: { ...baseStyle, width: 14, borderRadius: 6, opacity: busy ? 0.4 : 0.65 },
            }, h('svg', {
              width: 10, height: 10, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
              strokeWidth: 2.4, strokeLinecap: 'round', 'aria-hidden': 'true',
            }, [h('path', { key: 'p', d: 'M6 9l6 6 6-6' })])),
          ])
        }

        function Toggle(props) {
          return h('label', {
            style: {
              display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0',
              borderBottom: '1px solid rgba(127,127,127,0.18)',
              cursor: props.disabled ? 'default' : 'pointer',
            },
          }, [
            h('input', {
              key: 'i',
              type: 'checkbox',
              checked: props.value === true,
              disabled: props.disabled === true,
              onChange: (event) => props.onChange(event.target.checked),
              style: { marginTop: 2 },
            }),
            h('span', { key: 't', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
              h('span', { key: 'l', style: { fontSize: 13, fontWeight: 600 } }, props.label),
              props.hint ? h('span', { key: 'h', style: { fontSize: 11.5, opacity: 0.68, lineHeight: 1.5 } }, props.hint) : null,
            ]),
          ])
        }

        function SettingsPage() {
          const [settings, setSettings] = useState(null)
          const [status, setStatus] = useState('')
          const [error, setError] = useState('')
          const [propsDiag, setPropsDiag] = useState('')

          useEffect(() => {
            let alive = true
            shot.getSettings()
              .then((value) => { if (alive) setSettings(value) })
              .catch((caught) => { if (alive) setError(caught && caught.message ? caught.message : t('loadFailed')) })
            return () => { alive = false }
          }, [])

          const save = useCallback(async (patch) => {
            setSettings((current) => ({ ...(current || {}), ...patch }))
            setStatus(t('saving'))
            try {
              const saved = await shot.saveSettings(patch)
              setSettings(saved)
              setStatus(t('saved'))
              window.setTimeout(() => setStatus(''), 1500)
            } catch (caught) {
              setError(caught && caught.message ? caught.message : String(caught))
              setStatus('')
            }
          }, [])

          const body = []
          body.push(h('div', { key: 'h', style: { display: 'flex', alignItems: 'baseline', gap: 10 } }, [
            h('h2', { key: 't', style: { margin: 0, fontSize: 15, fontWeight: 650 } }, t('settingsTitle')),
            status ? h('span', { key: 's', style: { fontSize: 11.5, opacity: 0.6 } }, status) : null,
          ]))
          body.push(h('p', { key: 'd', style: { margin: '4px 0 8px', fontSize: 12, opacity: 0.7, lineHeight: 1.6 } }, t('settingsSubtitle')))
          body.push(h('p', { key: 'n', style: { margin: '0 0 8px', fontSize: 11.5, opacity: 0.62, lineHeight: 1.65 } }, t('noteModelOnly')))
          body.push(h('p', { key: 's', style: { margin: '0 0 8px', fontSize: 11.5, opacity: 0.62, lineHeight: 1.65 } }, t('shortcutHint')))

          if (error) body.push(h('p', { key: 'e', style: { color: '#c62828', fontSize: 12 } }, error))
          if (!settings) {
            body.push(h('p', { key: 'l', style: { fontSize: 12, opacity: 0.6 } }, t('loadFailed')))
            return h('div', null, body)
          }

          body.push(h(Toggle, {
            key: 'tool',
            label: t('enableTool'),
            hint: t('enableToolHint'),
            value: settings.enabled,
            onChange: (value) => save({ enabled: value }),
          }))
          body.push(h(Toggle, {
            key: 'ask',
            label: t('ask'),
            hint: t('askHint'),
            value: settings.askBeforeCapture,
            disabled: settings.enabled !== true,
            onChange: (value) => save({ askBeforeCapture: value }),
          }))

          const last = settings.lastRegion
          body.push(h('div', {
            key: 'last',
            style: {
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0',
              fontSize: 12, borderBottom: '1px solid rgba(127,127,127,0.18)',
            },
          }, [
            h('span', { key: 'l', style: { flex: 1, opacity: 0.75 } },
              t('lastRegion') + '：' + (last
                ? (last.width + 'x' + last.height + ' @ (' + last.x + ',' + last.y + ')')
                : t('none'))),
            last ? h('button', {
              key: 'c',
              type: 'button',
              onClick: () => save({ lastRegion: null }),
              style: { padding: '3px 10px', fontSize: 11.5, borderRadius: 6, cursor: 'pointer' },
            }, t('clear')) : null,
          ]))

          body.push(h('div', { key: 'diag', style: { marginTop: 14, paddingTop: 10, fontSize: 11.5, opacity: 0.75 } }, [
            h('div', { key: 'c' }, '连接：' + diagnostics(ctx)),
            h('button', {
              key: 't',
              type: 'button',
              onClick: async () => {
                setPropsDiag('测试中…')
                try {
                  const result = await shot.capture({ target: 'screen', maxWidth: 800 })
                  setPropsDiag('截图成功：' + result.width + 'x' + result.height + '（' + result.path + '）')
                } catch (caught) {
                  const message = caught && caught.message ? caught.message : String(caught)
                  setPropsDiag('截图失败：' + message)
                }
              },
              style: { marginTop: 6, padding: '4px 10px', fontSize: 11.5, borderRadius: 6, cursor: 'pointer' },
            }, '测试截图（只截不入框）'),
            propsDiag ? h('div', { key: 'r', style: { marginTop: 6, whiteSpace: 'pre-wrap' } }, propsDiag) : null,
          ]))
          return h('div', null, body)
        }

        const onShortcut = (event) => {
          if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return
          if (String(event.key).toLowerCase() !== 's') return
          event.preventDefault()
          event.stopPropagation()
          performShot('region')
        }
        document.addEventListener('keydown', onShortcut, true)
        ctx.effect(() => () => document.removeEventListener('keydown', onShortcut, true))

        ctx.slots.inject('conversation.input.left', function () {
          return ctx.slots.register({
            name: 'conversation.input.left',
            id: 'screenshot',
            order: 90,
            label: function () { return t('button') },
          }, ShotButton)
        })

        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'screenshot',
            order: 46,
            label: function () { return t('label') },
          }, SettingsPage)
        })
      },
    }
  },
})
