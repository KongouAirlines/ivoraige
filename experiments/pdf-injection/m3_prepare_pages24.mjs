// Source-image corrections for the fixed R03 representative pages.
import { createApp } from '../../src/app.mjs'

const store = new URL('../../evaluation/runs/m3-4/store', import.meta.url).pathname.replace(/^\/(?=[A-Z]:)/, '')
const app = await createApp({ store })
try {
  const display = [
    ['R03-p2', 'R03-M3-2-p02-u009', ['M_sat', 'A_ex', 'M_sat']],
    ['R03-p2', 'R03-M3-2-p02-u019', ['MuMax3', 'f', 'x', 'y', 'z', 'x', 'y', 'z', 'x²+y²+z²≤r²']],
    ['R03-p4', 'R03-M3-2-p04-u004', ['z', '矢量 ', 'mₓ = ', 'γ_LL t']],
    ['R03-p4', 'R03-M3-2-p04-u007', ['γ_LL', 'α', '矢量 ', '_eff', '矢量 ', 'γ_LL', '_eff']],
    ...[9, 10, 11, 12, 13].map(n => ['R03-p4', `R03-M3-2-p04-u${String(n).padStart(3, '0')}`, ['•', '矢量 ']]),
    ['R03-p4', 'R03-M3-2-p04-u017', ['矢量 ', '= M_sat 矢量 ', 'M_sat']],
  ]
  for (const [doc, unit, values] of display) await app.records.correctSourceBinding(doc, unit, 'display', values)
  await app.records.correctSourceBinding('R03-p4', 'R03-M3-2-p04-u007', 'order', {
    sourceText: 'with<b1>the gyromagnetic ratio (rad/(T·s)), <b2>the dimensionless damping parameter and <b3>B<b4>the effective field (T). The default value for <b6> can be overridden by the user. <b5>B<b7> has the following contributions:',
    order: ['<b1>', '<b2>', '<b3>', '<b4>', '<b6>', '<b5>', '<b7>'],
    reason: 'Original page places the orphan vector arrow on B_eff in the second sentence, after gamma_LL.',
  })
  await app.records.updateSource('R03-p4', 'R03-M3-2-p04-u016',
    'Magnetostatic convolution. A finite difference discretization allows the magnetostatic field to be evaluated as a (discrete) convolution of the magnetization with a demagnetizing kernel K̂:')
  console.log('Source and display corrections saved for selected pages')
} finally { await app.dispose() }
