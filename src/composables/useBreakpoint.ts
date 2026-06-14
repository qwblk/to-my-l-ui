/**
 * Reactive viewport breakpoint detection.
 *
 * Single source of truth for "am I on a small screen right now."
 * Uses MediaQueryList so it doesn't fire on every resize tick — only
 * when the viewport actually crosses the threshold.
 *
 * Usage:
 *   const { isSmall, isPhone } = useBreakpoint()
 *   <el-dialog :fullscreen="isSmall.value" />
 */
import { onMounted, onUnmounted, ref } from 'vue'

/** ≤ 960px — phone or tablet. Drives bottom tab bar, compact spacing,
 *  fullscreen dialogs, all of the small-screen behaviour. Matches the
 *  CSS @media (max-width: 960px) blocks in style.css. */
const SMALL_QUERY = '(max-width: 960px)'
/** ≤ 600px — phone only. Used sparingly: pure phone-only tweaks like
 *  hiding tab bar labels in landscape, or extreme spacing reductions. */
const PHONE_QUERY = '(max-width: 600px)'

export function useBreakpoint() {
  const isSmall = ref(false)
  const isPhone = ref(false)

  let smallMql: MediaQueryList | null = null
  let phoneMql: MediaQueryList | null = null
  const onSmall = () => { isSmall.value = !!smallMql?.matches }
  const onPhone = () => { isPhone.value = !!phoneMql?.matches }

  onMounted(() => {
    smallMql = window.matchMedia(SMALL_QUERY)
    phoneMql = window.matchMedia(PHONE_QUERY)
    onSmall()
    onPhone()
    smallMql.addEventListener('change', onSmall)
    phoneMql.addEventListener('change', onPhone)
  })

  onUnmounted(() => {
    smallMql?.removeEventListener('change', onSmall)
    phoneMql?.removeEventListener('change', onPhone)
  })

  return { isSmall, isPhone }
}
