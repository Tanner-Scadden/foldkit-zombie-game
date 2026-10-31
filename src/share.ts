import type { Difficulty } from './playerData'

// Share to X from the end of a run: the post's text and the link to X's post
// intent. Every word a shared post says lives here, so the owner can tweak
// the voice in one place. The link carries the game's address and nothing
// else: no tracking parameters and no tokens.

export const GAME_URL = 'https://munch-manor.tanner-scadden.workers.dev/'

const X_POST_INTENT = 'https://x.com/intent/post'

// NOTE: what a post is built from: how the run ended, its wave, difficulty,
// and kills, and how many players were in it (1 alone).
export type SharedRun = Readonly<{
  outcome: 'Munched' | 'Won'
  isEndless: boolean
  wave: number
  difficulty: Difficulty
  kills: number
  crew: number
}>

const SHOUTED: Readonly<Record<Difficulty, string>> = {
  Easy: 'Easy',
  Normal: 'Normal',
  Hard: 'HARD',
  Nightmare: 'NIGHTMARE',
}

const splatted = (kills: number): string =>
  kills === 1 ? '1 zombie splatted' : `${kills} zombies splatted`

const where = ({ isEndless, wave }: SharedRun): string =>
  isEndless ? `endless wave ${wave}` : `wave ${wave}`

const soloText = (run: SharedRun): string =>
  run.outcome === 'Won'
    ? `🧟 I beat Munch Manor on ${SHOUTED[run.difficulty]}! ${splatted(run.kills)}. The house is mine.`
    : `💀 Got munched on ${where(run)} in Munch Manor. ${splatted(run.kills)} first. Your turn!`

const crewText = (run: SharedRun): string =>
  run.outcome === 'Won'
    ? `🧟 Our crew of ${run.crew} beat Munch Manor on ${SHOUTED[run.difficulty]}! ${splatted(run.kills)} together.`
    : `💀 Our crew of ${run.crew} got munched on ${where(run)} in Munch Manor. ${splatted(run.kills)} together. Bring snacks.`

export const shareText = (run: SharedRun): string =>
  run.crew > 1 ? crewText(run) : soloText(run)

export const shareUrl = (run: SharedRun): string =>
  `${X_POST_INTENT}?text=${encodeURIComponent(shareText(run))}&url=${encodeURIComponent(GAME_URL)}`
