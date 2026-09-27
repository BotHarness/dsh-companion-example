/**
 * dsh-companion-example — Host half.
 *
 * The example exists to show the three DSH seams a desktop-companion plugin
 * needs, using public plugin APIs only:
 *
 *   1. a Cordis Service (`ctx.companion`) other plugins can inject and call;
 *   2. global listeners on agent/session lifecycle events that drive a small
 *      mood state machine (idle / thinking / working / done / error);
 *   3. a Typert Remote namespace (`companion`) the browser half reaches through
 *      the API Gateway's `/api` channel.
 *
 * This file is the bundle's host row: `cordis.patch.yml` inserts the package,
 * the Loader imports this module, and the same package's `dsh.client`
 * declaration hands `./client.js` to the browser.
 */
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export const name = 'dsh-companion-example'

/** Moods the badge can show. `done` and `error` decay back to `idle`. */
const MOODS = ['idle', 'thinking', 'working', 'done', 'error']
const DECAY_MS = 4000

/**
 * Cordis Service + Typert Remote binding. Other Host plugins consume it with
 * `inject: ['companion']`; the browser half calls `companion/getState` and
 * `companion/setMood` through `/api`.
 */
export class CompanionService extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'companion', { namespace: 'companion' })

    // Plain properties, not `#private` fields: Cordis serves a service through
    // its tracing proxy, and `#private` brand-checks reject that receiver
    // ("Cannot read private member ... from an object whose class did not
    // declare it"). Upstream Remote services use TS `private`, i.e. plain
    // properties, for the same reason.
    this.mood = 'idle'
    this.updatedAt = Date.now()
    this.decay = undefined

    // Global listeners: one companion watches every agent, not one session scope.
    ctx.on('session/event', (_session, event) => this.onSessionEvent(event), { global: true })
    ctx.on('agent/status', ({ status }) => {
      if (status === 'running') applyMood(this, 'thinking')
    }, { global: true })
    ctx.on('agent/error', () => applyMood(this, 'error'), { global: true })
    ctx.effect(() => () => clearTimeout(this.decay), 'dsh-companion-example: mood decay')

    // When the shell provides the desktop window seam, the companion moves to a
    // real window; without it (plain web profile) the badge stays in the corner.
    ctx.inject(['desktopWindows'], (windowCtx) => {
      windowCtx.effect(() => {
        let windowId
        let disposed = false
        windowCtx.desktopWindows.open({
          id: 'companion-window',
          surface: 'dsh-companion-example',
          width: 260,
          height: 200,
          anchor: 'bottom-right',
          margin: [24, 24],
          alwaysOnTop: true,
          transparent: true,
          skipTaskbar: true,
        }).then((id) => {
          if (disposed) void windowCtx.desktopWindows.close(id).catch(() => {})
          else windowId = id
        }, (error) => { console.error('dsh-companion-example: desktop window failed to open', error) })
        return () => {
          disposed = true
          if (windowId !== undefined) void windowCtx.desktopWindows.close(windowId).catch(() => {})
        }
      }, 'dsh-companion-example: desktop window')
    })
  }

  /** Current mood. Called by other plugins and by `companion/getState`. */
  getState() {
    return { mood: this.mood, updatedAt: this.updatedAt }
  }

  /** Set the mood by hand. The badge cycles moods on click. */
  setMood(mood) {
    if (!MOODS.includes(mood)) {
      throw new RemoteError('gateway/bad-request', `unknown mood: ${String(mood)}`, {})
    }
    applyMood(this, mood)
    return this.getState()
  }

  /** One `session/event` from any agent, folded into the mood state machine. */
  onSessionEvent(event) {
    switch (event.type) {
      case 'turn/start':
      case 'step/start':
      case 'assistant/message':
        applyMood(this, 'thinking')
        break
      case 'tool/call':
        applyMood(this, 'working')
        break
      case 'tool/result':
        applyMood(this, event.data.error === undefined ? 'thinking' : 'error')
        break
      case 'turn/end':
        applyMood(this, turnEndMood(event.data.reason))
        break
      default:
        break
    }
  }
}

function applyMood(service, mood) {
  service.mood = mood
  service.updatedAt = Date.now()
  clearTimeout(service.decay)
  if (mood === 'done' || mood === 'error') {
    service.decay = setTimeout(() => applyMood(service, 'idle'), DECAY_MS)
    service.decay.unref?.()
  }
}

function turnEndMood(reason) {
  switch (reason?.kind) {
    case 'completed':
      return 'done'
    case 'error':
    case 'aborted':
    case 'max-tokens':
      return 'error'
    default:
      return 'idle'
  }
}

/**
 * Mark the two Remote methods without a build step.
 *
 * `@Remote` is a standard decorator; this repo ships plain ESM, so the marker
 * the decorator would write is written directly instead. The property name and
 * descriptor shape are the protocol's wire contract (upstream
 * `packages/typert/protocol/src/index.ts`, `REMOTE_METHOD_DESCRIPTOR`), and the
 * Gateway reads them through `remoteMethods()` in SRC mode.
 */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

function markRemoteMethods(prototype, methods) {
  const descriptor = {
    version: 1,
    methods: methods.map((method) =>
      Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' }) }),
    ),
  }
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze(descriptor),
  })
}

markRemoteMethods(CompanionService.prototype, ['getState', 'setMood'])

export default CompanionService
