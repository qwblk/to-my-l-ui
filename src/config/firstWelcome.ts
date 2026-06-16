/**
 * First-login welcome content.
 *
 * IMPORTANT: the receiver's welcome letter is intentionally the exact
 * text provided by the user, only split into paragraphs for layout. Do
 * not rewrite, soften, translate, or prepend backend greeting.
 */
import {
  CURRENT_USER_NAME,
  PARTNER_USER_NAME,
} from '@/config/env'

export const FIRST_WELCOME_STORAGE_KEY = 'tml:first-welcome:v2'

export interface FirstWelcomeContent {
  title: string
  paragraphs: string[]
  video?: string
  audio?: string
  audioTitle?: string
  confirmText: string
}

const LETTER_FOR_HER: FirstWelcomeContent = {
  title: '写给你的话',
  paragraphs: [
    '嗨，当你看到这段话的时候，我藏了好久的心事，终于敢轻轻放到你面前了。',
    '这是我为你搭的一处小空间，不是社交软件，也不是什么程序后台。它只装着一件事 —— 那些和你有关的日子，那些到了嘴边又咽回去的话，那些我一个人悄悄珍藏的瞬间。',
    '以前总以为，足够用心的付出总能被看见，总能捂热一颗心。可后来我也明白，爱情里从来没有 “努力就有结果” 的公式。感动换不来心动，喜不喜欢从来都勉强不来，这点我一直都懂。',
    '所以你完全不用紧张。我把这些摆到你面前，不是要你给我一个答复，更不是要你勉强给出什么结果。我只是想完完整整地告诉你：我真的很喜欢你。',
    '你可以慢慢看，随便逛，不用有任何心理负担。这里面藏着我的胆怯，也藏着我的认真，那些没说出口的小心思，终于有了能让你看见的地方。不用急，慢慢逛就好。',
  ],
  confirmText: '我慢慢看',
}

const LETTER_FOR_ME: FirstWelcomeContent = {
  title: '欢迎回来',
  paragraphs: [
    '今天也可以写下一点什么。',
    '不用很长，一句话也算数。',
  ],
  confirmText: '开始记录',
}

/** Read a comma-separated list from a Vite env var, normalised to lower
 *  case so case-insensitive matching works regardless of how the user
 *  typed their username at the login form. */
function readAliasList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

const HER_ALIASES = [
  PARTNER_USER_NAME.toLowerCase(),
  ...readAliasList(import.meta.env.VITE_PARTNER_USERNAMES),
]
const HIM_ALIASES = [
  CURRENT_USER_NAME.toLowerCase(),
  ...readAliasList(import.meta.env.VITE_CURRENT_USERNAMES),
]

const aliasMap: Record<string, FirstWelcomeContent> = {}
for (const a of HER_ALIASES) if (a) aliasMap[a] = LETTER_FOR_HER
for (const a of HIM_ALIASES) if (a) aliasMap[a] = LETTER_FOR_ME

export const FIRST_WELCOME_BY_USERNAME = aliasMap

export const DEFAULT_FIRST_WELCOME: FirstWelcomeContent = LETTER_FOR_HER

