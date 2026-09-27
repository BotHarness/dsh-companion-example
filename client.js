/**
 * dsh-companion-example — browser half.
 *
 * The client module system serves this file as a lazy-CJS factory: one script
 * that registers the package id and a `factory(require)`. It renders a badge
 * in the frame-wide `shell.overlay` slot and reads/commands the Host companion
 * service through the shared `/api` channel.
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

    function CompanionBadge({ getState, setMood }) {
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
      return React.createElement(
        'button',
        {
          type: 'button',
          title: error === undefined ? `companion: ${mood}` : String(error.message ?? error),
          onClick: () => {
            setMood(nextMood(mood)).then(
              (next) => setState(next),
              (cause) => setError(cause),
            )
          },
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
        React.createElement('span', {
          style: {
            width: 8,
            height: 8,
            borderRadius: 999,
            background: MOOD_COLORS[mood] ?? MOOD_COLORS.idle,
          },
        }),
        React.createElement('span', null, `companion · ${mood}`),
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
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'dsh-companion-example',
              order: 100,
              inject: () => ({
                getState: () => call('getState', {}),
                setMood: (mood) => call('setMood', { mood }),
              }),
            },
            CompanionBadge,
          ),
        )
      },
    }
  },
})
