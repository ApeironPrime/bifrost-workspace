import { createLandingT, type Language } from '../../i18n/landing'
import { useEffect, useRef, useState } from 'react'
import { IcoCam, IcoFile, IcoMic } from './Icons'
import './collaboration-atelier.css'

type Lens = 'call' | 'note' | 'file'

export default function CollaborationAtelier({ lang, onEnter }: { lang: Language; onEnter: () => void }) {
  const t = createLandingT(lang)
  const [lens, setLens] = useState<Lens>('call')
  const stage = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = stage.current
    if (!element || !('IntersectionObserver' in window)) return
    let visible = false
    const sync = () => { element.dataset.playing = String(visible && !document.hidden) }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) element.dataset.arrived = 'true'
      sync()
    }, { threshold: .18 })
    observer.observe(element)
    document.addEventListener('visibilitychange', sync)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', sync) }
  }, [])
  const lenses: { id: Lens; title: string; detail: string }[] = [
    { id: 'call', title: t('landing.atelier.lensCallTitle'), detail: t('landing.atelier.lensCallDetail') },
    { id: 'note', title: t('landing.atelier.lensNoteTitle'), detail: t('landing.atelier.lensNoteDetail') },
    { id: 'file', title: t('landing.atelier.lensFileTitle'), detail: t('landing.atelier.lensFileDetail') },
  ]
  return <section className="collab-atelier" id="how-it-works" aria-labelledby="atelier-title">
    <div className="atelier-masthead"><span>{t('landing.atelier.chapterLabel')}</span><small>{t('landing.atelier.chapterSummary')}</small></div>
    <div className="atelier-layout">
      <header className="atelier-editorial">
        <p className="atelier-eyebrow">{t('landing.atelier.eyebrow')}</p>
        <h2 id="atelier-title">{t('landing.atelier.headlineLead')}<br /><em>{t('landing.atelier.headlineEm1')}<br />{t('landing.atelier.headlineEm2')}</em></h2>
        <p className="atelier-description">{t('landing.atelier.description')}</p>
        <div className="atelier-lenses" role="group" aria-label={t('landing.atelier.lensesAria')}>{lenses.map((item, index) => <button key={item.id} type="button" aria-pressed={lens === item.id} aria-controls="product" onClick={() => setLens(item.id)}><span>0{index + 1}</span><strong>{item.title}</strong><span aria-hidden="true">↗</span></button>)}</div>
        <button type="button" className="atelier-enter" onClick={onEnter}>{t('landing.atelier.enterTeam')} <span>↗</span></button>
      </header>

      <div ref={stage} className="atelier-stage" id="product" data-lens={lens} aria-label={t('landing.atelier.stageAria')}>
        <div className="atelier-stage-label"><span>{t('landing.atelier.stageRoomLabel')}</span><span>{t('landing.atelier.stagePresence')}</span></div>
        <svg className="atelier-thread" viewBox="0 0 800 760" fill="none" aria-hidden="true"><path d="M130 210 C130 60 670 35 675 300 S690 660 480 665 S70 740 110 530"/><path className="atelier-thread-signal" d="M130 210 C130 60 670 35 675 300 S690 660 480 665 S70 740 110 530"/></svg>

        <article className="atelier-presence" data-object="call">
          <header><span>01 / {t('landing.atelier.cardCallLabel')}</span><IcoCam size={17}/></header>
          <div className="atelier-faces"><span>MA<small>Minh Anh</small></span><span>KH<small>Khoa</small></span></div>
          <div className="atelier-audio" aria-hidden="true">{[7, 14, 24, 12, 30, 20, 10, 26, 16, 8, 19, 11, 6].map((height,index)=><i key={index} style={{height}}/>)}</div>
          <p>{t('landing.atelier.cardCallQuote')}</p>
          <footer><IcoMic size={12}/><span>WebRTC · P2P</span></footer>
        </article>

        <article className="atelier-paper" data-object="note">
          <header><span>02 / {t('landing.atelier.cardNoteLabel')}</span><span>{t('landing.atelier.cardNoteStatus')}</span></header>
          <small>{t('landing.atelier.cardNoteKicker')}</small>
          <h3>{t('landing.atelier.cardNoteTitle')}</h3>
          <p>{t('landing.atelier.cardNoteBody')}</p>
          <div className="atelier-paper-lines"><span><i/> {t('landing.atelier.cardNotePoint1')}</span><span><i/> {t('landing.atelier.cardNotePoint2')}</span></div>
          <footer><span className="atelier-author">MA</span><span>{t('landing.atelier.cardNoteAuthor')}</span><span>↗</span></footer>
        </article>

        <article className="atelier-material" data-object="file">
          <div className="atelier-file-art" aria-hidden="true"><span/><span/><span/></div>
          <div><small>03 / {t('landing.atelier.cardFileLabel')}</small><strong>room-layout.pdf</strong><span>{t('landing.atelier.cardFileNote')}</span></div><IcoFile size={20}/>
        </article>
        <div className="atelier-caption" aria-live="polite"><span aria-hidden="true">↳</span><p key={lens}>{lenses.find(item => item.id === lens)?.detail}</p></div>
        <div className="atelier-coordinate" aria-hidden="true">B / 001 <span>{t('landing.atelier.coordinateMotif')}</span></div>
      </div>
    </div>
    <div className="atelier-colophon"><span>{t('landing.atelier.colophonLabel')}</span><p>{t('landing.atelier.colophonTitle')}</p><a href="#meeting-record">{t('landing.atelier.colophonNext')} ↓</a></div>
  </section>
}
