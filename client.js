/**
 * dsh-companion-example — browser half.
 *
 * The client module system serves this file as a lazy-CJS factory: one script
 * that registers the package id and a `factory(require)`.
 *
 * Two surfaces, one plugin:
 *   - the main window renders the badge in the frame-wide `shell.overlay` slot;
 *   - a contributed window loads the Web application with `?dsh-surface=companion`
 *     and this plugin shadows the `root` slot, so only the companion surface renders.
 *
 * Only the shell module baseline may be required here (`react` and friends);
 * a package that grows a build inlines everything else.
 */
window.__ModuleLoader__.load({
  id: 'dsh-companion-example',
  factory(require) {
    const React = require('react')

    const MOOD_ORDER = ['idle', 'thinking', 'working', 'done', 'error']
    const MOOD_COLORS = {
      idle: '#8a8f98',
      thinking: '#d4a017',
      working: '#247bbf',
      done: '#2e9e5b',
      error: '#d64545',
    }

    function nextMood(mood) {
      return MOOD_ORDER[(MOOD_ORDER.indexOf(mood) + 1) % MOOD_ORDER.length]
    }

    function useCompanion(getState, setMood) {
      const [state, setState] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)

      React.useEffect(() => {
        let alive = true
        const refresh = () => {
          getState().then(
            (next) => {
              if (alive) {
                setState(next)
                setError(undefined)
              }
            },
            (cause) => {
              if (alive) setError(cause)
            },
          )
        }
        refresh()
        const timer = window.setInterval(refresh, 2000)
        return () => {
          alive = false
          window.clearInterval(timer)
        }
      }, [getState])

      const mood = state?.mood ?? 'idle'
      const cycle = () => {
        setMood(nextMood(mood)).then(
          (next) => setState(next),
          (cause) => setError(cause),
        )
      }
      return { mood, error, cycle }
    }

    function MoodDot({ mood, size }) {
      return React.createElement('span', {
        style: {
          width: size,
          height: size,
          borderRadius: 999,
          background: MOOD_COLORS[mood] ?? MOOD_COLORS.idle,
          display: 'inline-block',
        },
      })
    }

    function CompanionBadge({ getState, setMood }) {
      const { mood, error, cycle } = useCompanion(getState, setMood)
      return React.createElement(
        'button',
        {
          type: 'button',
          title: error === undefined ? `companion: ${mood}` : String(error.message ?? error),
          onClick: cycle,
          style: {
            position: 'fixed',
            right: 20,
            bottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 999,
            border: '1px solid rgba(127, 127, 127, 0.35)',
            background: 'rgba(20, 20, 20, 0.72)',
            color: '#f5f5f5',
            fontSize: 12,
            lineHeight: 1,
            // `shell.overlay` is a click-through layer; entries opt back in.
            pointerEvents: 'auto',
            cursor: 'pointer',
            zIndex: 40,
          },
        },
        React.createElement(MoodDot, { mood, size: 8 }),
        React.createElement('span', null, `companion · ${mood}`),
      )
    }

    function CompanionSurface({ getState, setMood }) {
      const { mood, error, cycle } = useCompanion(getState, setMood)
      return React.createElement(
        'div',
        {
          // The contributed window is frameless; this region is its drag handle.
          'data-window-drag': '',
          style: {
            width: '100vw',
            height: '100vh',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: 16,
            borderRadius: 18,
            background: 'rgba(20, 20, 20, 0.62)',
            color: '#f5f5f5',
            fontFamily: 'system-ui, sans-serif',
            WebkitAppRegion: 'drag',
          },
        },
        React.createElement(MoodDot, { mood, size: 28 }),
        React.createElement('div', { style: { fontSize: 13 } }, `companion · ${mood}`),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: cycle,
            style: {
              marginTop: 4,
              padding: '4px 12px',
              borderRadius: 999,
              border: '1px solid rgba(127, 127, 127, 0.5)',
              background: 'transparent',
              color: '#f5f5f5',
              fontSize: 12,
              cursor: 'pointer',
              WebkitAppRegion: 'no-drag',
            },
          },
          'cycle mood',
        ),
        error === undefined ? null : React.createElement('div', { style: { fontSize: 11, opacity: 0.7 } }, String(error.message ?? error)),
      )
    }

    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        const call = async (endpoint, args) => {
          const result = await ctx.connection.rpc.call('/api', `companion/${endpoint}`, { args })
          if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
          return result.value
        }
        const face = () => ({
          getState: () => call('getState', {}),
          setMood: (mood) => call('setMood', { mood }),
        })
        const surface = new URLSearchParams(window.location.search).get('dsh-surface')
        if (surface === 'dsh-companion-example') {
          // Shadow AppFrame so only the contributed window's surface renders.
          ctx.slots.inject('root', () =>
            ctx.slots.register({ name: 'root', priority: -1, inject: face }, CompanionSurface),
          )
          return
        }
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'dsh-companion-example', order: 100, inject: face }, CompanionBadge),
        )
      },
    }
  },
})
