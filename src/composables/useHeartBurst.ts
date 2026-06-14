/**
 * Heart-effect orchestrator.
 *
 * One <FloatingHearts ref="..."> is mounted at App root and registered here on
 * mount; any view can then call burst()/rain()/corners() without lifting a ref.
 *
 * Usage:
 *   import { useHeartBurst } from '@/composables/useHeartBurst'
 *   const hearts = useHeartBurst()
 *   hearts.burstFrom(buttonEl, 6)   // N hearts from element center
 *   hearts.rain()                   // anniversary mode
 *   hearts.corners()                // login success
 *
 * Counts here are *requests*; the user's heart-intensity preference acts
 * as a multiplier (off → no hearts, subtle → ~half, lavish → 1.6x).
 */
import { getHeartMultiplier } from './useSettings'

interface HeartsApi {
  burst: (x: number, y: number, count?: number) => void
  rain: (count?: number) => void
  corners: () => void
}

let registry: HeartsApi | null = null

export function registerHearts(api: HeartsApi) {
  registry = api
}

function scale(count: number): number {
  return Math.max(0, Math.round(count * getHeartMultiplier()))
}

export function useHeartBurst() {
  function burst(x: number, y: number, count = 6) {
    const n = scale(count)
    if (n) registry?.burst(x, y, n)
  }
  function burstFrom(el: HTMLElement | null | undefined, count = 6) {
    if (!el || !registry) return
    const n = scale(count)
    if (!n) return
    const r = el.getBoundingClientRect()
    registry.burst(r.left + r.width / 2, r.top + r.height / 2, n)
  }
  function rain(count = 32) {
    const n = scale(count)
    if (n) registry?.rain(n)
  }
  function corners() {
    if (getHeartMultiplier() > 0) registry?.corners()
  }
  return { burst, burstFrom, rain, corners }
}
