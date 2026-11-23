import { useEffect, type RefObject } from 'react'

/** Native, one-shot reveals; content remains visible without JS or motion support. */
export function useLandingMotion(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const page = root.current
    if (!page || !('IntersectionObserver' in window)) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let observer: IntersectionObserver | undefined
    const targets = Array.from(page.querySelectorAll<HTMLElement>(
      '.atelier-masthead, .atelier-editorial, .atelier-colophon, .outcome-lead, .outcome-grid, .outcome-action',
    ))
    const showAll = () => targets.forEach(target => target.removeAttribute('data-reveal'))
    const configure = () => {
      observer?.disconnect()
      showAll()
      if (preference.matches) return
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return
          entry.target.setAttribute('data-reveal', 'shown')
          observer?.unobserve(entry.target)
        })
      }, { threshold: 0, rootMargin: '0px 0px -35px 0px' })
      targets.forEach(target => {
        // Never hide the initial viewport, restored scroll position or focused content.
        if (target.getBoundingClientRect().top < window.innerHeight - 35) return
        target.setAttribute('data-reveal', 'pending')
        observer?.observe(target)
      })
    }
    const revealFocused = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return
      const target = event.target.closest('[data-reveal="pending"]')
      target?.setAttribute('data-reveal', 'shown')
      if (target) observer?.unobserve(target)
    }
    configure()
    preference.addEventListener('change', configure)
    page.addEventListener('focusin', revealFocused)
    return () => {
      observer?.disconnect()
      preference.removeEventListener('change', configure)
      page.removeEventListener('focusin', revealFocused)
      showAll()
    }
  }, [root])
}
