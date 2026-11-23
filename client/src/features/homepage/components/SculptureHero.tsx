import { createLandingT, type Language } from '../../../i18n/landing'
import { Fragment, useRef, useState } from 'react'
import { IcoCam, IcoCheck } from './Icons'

/** A visual study: the artwork is real imagery, not a simulated 3D model. */
export default function SculptureHero({ lang, onEnter }: { lang: Language; onEnter: () => void }) {
  const t = createLandingT(lang)
  const asideLines = t('landing.hero.aside').split('\n')
  const stage = useRef<HTMLElement>(null)
  const [detail, setDetail] = useState(false)
  return <section ref={stage} className={`sculpture-hero ${detail ? 'sculpture-detail' : ''}`} aria-label={t('landing.hero.sectionAria')} onPointerMove={event => {
    if (event.pointerType !== 'mouse') return
    const box = event.currentTarget.getBoundingClientRect()
    stage.current?.style.setProperty('--art-x', `${((event.clientX - box.left) / box.width - .5) * 12}px`)
    stage.current?.style.setProperty('--art-y', `${((event.clientY - box.top) / box.height - .5) * 8}px`)
  }} onPointerLeave={() => {
    stage.current?.style.setProperty('--art-x', '0px')
    stage.current?.style.setProperty('--art-y', '0px')
  }}>
    <div className="sculpture-art" aria-hidden="true"><img src="/design/paper-bridge-1672.webp" srcSet="/design/paper-bridge-640.webp 640w, /design/paper-bridge-960.webp 960w, /design/paper-bridge-1672.webp 1672w" sizes="(max-width: 560px) 200vw, 100vw" width="1672" height="941" alt="" fetchPriority="high" /></div>
    <div className="sculpture-topline"><span>{t('landing.hero.chapterLabel')}</span><span lang="ja">折り目の向こうで、出会う。</span></div>
    <div className="sculpture-heading"><p>{t('landing.hero.eyebrow')}</p><h1>{t('landing.hero.headlineLead')}<br /><em>{t('landing.hero.headlineEmphasis')}</em></h1></div>
    <p className="sculpture-aside">{asideLines.map((line, index) => <Fragment key={line}>{index > 0 && <br />}{line}</Fragment>)}</p>
    <div className="sculpture-art-label sculpture-session" aria-label={t('landing.hero.sessionAria')}>
      <div className="sculpture-session-people"><span>MA</span><span>KH</span><IcoCam size={13}/><span className="sculpture-wave" aria-hidden="true"><i/><i/><i/><i/><i/></span><small>{t('landing.hero.inOneRoom')}</small></div>
      <p className="sculpture-session-thought">{t('landing.hero.quote')}</p>
      <div className="sculpture-session-result"><IcoCheck size={12}/><div><small>{t('landing.hero.capturedLabel')}</small><span>{t('landing.hero.capturedDetail')}</span></div></div>
    </div>
    <div className="sculpture-bottom"><div className="sculpture-invitation"><button type="button" onClick={onEnter}>{t('landing.hero.enterSpace')} <span>↗</span></button><p>{t('landing.hero.enterSubtitle')}</p></div><button type="button" className="sculpture-inspect" aria-label={detail ? t('landing.hero.inspectCloseAria') : t('landing.hero.inspectOpenAria')} aria-pressed={detail} onClick={() => setDetail(!detail)}><span>{detail ? '−' : '+'}</span><div><small>{t('landing.hero.inspectEyebrow')}</small><strong>{detail ? t('landing.hero.inspectCloseAria') : t('landing.hero.inspectPrompt')}</strong></div></button></div>
    <div className="sculpture-foot"><span>WebRTC · P2P</span><a href="#how-it-works" aria-label={t('landing.hero.exploreFeaturesAria')}><span aria-hidden="true">↓</span></a><span>{t('landing.hero.taglineFoot')}</span></div>
  </section>
}
