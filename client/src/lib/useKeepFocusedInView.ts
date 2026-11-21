import { useCallback, useEffect, type RefObject } from 'react';

/**
 * Keeps a focused composer or editor textarea scrolled into view both on initial focus
 * and when a mobile virtual keyboard resizes the layout/visual viewport afterwards.
 */
export function useKeepFocusedInView(targetRef: RefObject<HTMLElement | null>) {
  const scrollTargetIntoView = useCallback(() => {
    targetRef.current?.scrollIntoView({ block: 'nearest' });
  }, [targetRef]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let rafId = 0;

    const handleViewportResize = () => {
      const el = targetRef.current;
      if (!el || document.activeElement !== el) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (document.activeElement === el) {
          el.scrollIntoView({ block: 'nearest' });
        }
      });
    };

    window.addEventListener('resize', handleViewportResize);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', handleViewportResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleViewportResize);
      visualViewport?.removeEventListener('resize', handleViewportResize);
    };
  }, [targetRef]);

  return useCallback(() => {
    requestAnimationFrame(scrollTargetIntoView);
  }, [scrollTargetIntoView]);
}
