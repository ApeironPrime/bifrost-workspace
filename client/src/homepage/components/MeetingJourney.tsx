import { createLandingT, type Language } from '../../i18n/landing'
import { IcoFile, IcoCheck } from './Icons'
import CollaborationAtelier from './CollaborationAtelier'

export default function MeetingJourney({ lang, onEnter }: { lang: Language; onEnter: () => void }) {
  const t = createLandingT(lang)
  return <>
    <CollaborationAtelier lang={lang} onEnter={onEnter} />
    <section className="meeting-outcome" id="meeting-record" aria-labelledby="outcome-title">
      <div className="outcome-edition"><span>{t('landing.outcome.chapterLabel')}</span><span>{t('landing.outcome.workingTogether')}</span></div>
      <header className="outcome-lead">
        <span className="outcome-margin" aria-hidden="true">{t('landing.outcome.marginNote')}<i /></span>
        <h2 id="outcome-title">{t('landing.outcome.headlineLine1')}<br />{t('landing.outcome.headlineLine2')}</h2>
        <p>{t('landing.outcome.description')}</p>
      </header>
      <div className="outcome-context"><span>{t('landing.outcome.contextTitle')}</span><span>Minh Anh <i>×</i> Khoa</span><span>{t('landing.outcome.roomBadge')}</span></div>
      <div className="outcome-grid">
        <article className="outcome-idea">
          <h3><span>01</span>{t('landing.outcome.card1Title')}</h3>
          <p>{t('landing.outcome.card1Body')}</p>
          <footer><span>MA</span><span>{t('landing.outcome.card1Author')}</span></footer>
        </article>
        <article className="outcome-resources">
          <h3><span>02</span>{t('landing.outcome.card2Title')}</h3>
          <div><IcoFile size={20} /><span>room-layout.pdf<small>{t('landing.outcome.card2File1Desc')}</small></span><small>PDF</small></div>
          <div><IcoFile size={20} /><span>design-feedback.png<small>{t('landing.outcome.card2File2Desc')}</small></span><small>PNG</small></div>
        </article>
        <article className="outcome-next">
          <h3><span>03</span>{t('landing.outcome.card3Title')}</h3>
          <IcoCheck size={26} />
          <p>{t('landing.outcome.card3Body')}</p>
          <small>{t('landing.outcome.card3Note')}</small>
        </article>
      </div>
      <div className="outcome-action">
        <div><span>{t('landing.outcome.actionEyebrow')}</span><p>{t('landing.outcome.actionPrompt')}</p></div>
        <button type="button" onClick={onEnter}>{t('landing.openWorkspace')}<span aria-hidden="true">↗</span></button>
      </div>
    </section>
  </>
}
