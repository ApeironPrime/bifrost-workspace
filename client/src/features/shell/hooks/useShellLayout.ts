import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { useTabTransition } from '../../room/hooks/useTabTransition';
import { tabDirection } from '../../../lib/tabDirection';
import { useRoomTabIndicator } from '../../room/hooks/useRoomTabIndicator';
import {
  getNextRoomTab,
  roomPanelElementId,
  roomTabElementId,
  syncEmptyTabPanelTabIndex,
  type RoomTabId,
} from '../../../lib/roomTabs';
import { readWorkspaceRoute, workspaceHash, type WorkspaceRoute } from '../../../lib/roomUiState';
import { createRailTipStore } from '../../../lib/railTipStore';
import type { I18nKey, Language } from '../../../i18n';

export type RoomTab = RoomTabId;

export interface UseShellLayoutOptions {
  lang: Language;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  currentRoomId?: string;
  currentRoomWorkspaceId?: string;
  roomReadOnly: boolean;
  peersCount: number;
  onRouteWorkspaceId?: (workspaceId: string) => void;
}

export function useShellLayout({
  lang,
  t,
  currentRoomId,
  currentRoomWorkspaceId,
  roomReadOnly,
  peersCount,
  onRouteWorkspaceId,
}: UseShellLayoutOptions) {
  const [requestedRoute, setRequestedRoute] = useState(() => readWorkspaceRoute(location.hash));
  const [compactLayout, setCompactLayout] = useState(() => matchMedia('(max-width: 1024px)').matches);
  const [activeTab, setActiveTab] = useState<RoomTab>('meeting');
  const tabTransition = useTabTransition();
  const roomTabsRef = useRoomTabIndicator(activeTab, lang, currentRoomId);
  const roomTabButtonRefs = useRef<Partial<Record<RoomTab, HTMLButtonElement | null>>>({});
  const filesPanelRef = useRef<HTMLDivElement>(null);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('bifrost_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const railTipStore = useMemo(() => createRailTipStore(), []);

  const changeRoute = useCallback((route: WorkspaceRoute, replace = false) => {
    const hash = workspaceHash(route);
    if (location.hash !== hash) {
      history[replace ? 'replaceState' : 'pushState'](null, '', hash);
    }
    setRequestedRoute(route);
  }, []);

  useEffect(() => {
    const restore = () => {
      if (location.hash.startsWith('#workspace')) {
        const route = readWorkspaceRoute(location.hash);
        setRequestedRoute(route);
        if (route.workspaceId) onRouteWorkspaceId?.(route.workspaceId);
      }
    };
    addEventListener('popstate', restore);
    addEventListener('hashchange', restore);
    return () => {
      removeEventListener('popstate', restore);
      removeEventListener('hashchange', restore);
    };
  }, [onRouteWorkspaceId]);

  useEffect(() => {
    const query = matchMedia('(max-width: 1024px)');
    const resize = () => {
      setCompactLayout(query.matches);
      setIsSidebarOpen(false);
      setIsRightPanelOpen(false);
      railTipStore.set(null);
    };
    query.addEventListener('change', resize);
    return () => query.removeEventListener('change', resize);
  }, [railTipStore]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t('landing.documentTitle');
  }, [lang, t]);

  useEffect(() => {
    roomTabButtonRefs.current[activeTab]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);

  const sidebarExpanded = compactLayout ? isSidebarOpen : !sidebarCollapsed;
  const sidebarVisible = !compactLayout || isSidebarOpen;
  const isCompactRail = Boolean(sidebarCollapsed && !compactLayout);
  const isCompactRailRef = useRef(isCompactRail);

  useEffect(() => {
    isCompactRailRef.current = isCompactRail;
    if (!isCompactRail) railTipStore.set(null);
  }, [isCompactRail, railTipStore]);

  const toggleSidebar = useCallback(() => {
    const nextVisible = !sidebarExpanded;
    railTipStore.set(null);
    if (compactLayout) {
      setIsSidebarOpen(nextVisible);
    } else {
      setSidebarCollapsed(!nextVisible);
      try {
        localStorage.setItem('bifrost_sidebar_collapsed', String(!nextVisible));
      } catch {
        /* Preference is optional. */
      }
    }
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          !compactLayout || nextVisible ? '.app-sidebar .workspace-brand' : '.app-header .sidebar-brand-toggle',
        )
        ?.focus({ preventScroll: true }),
    );
  }, [compactLayout, railTipStore, sidebarExpanded]);

  const showRailTip = useCallback(
    (target: HTMLElement, label: string) => {
      if (!isCompactRailRef.current || document.querySelector(':popover-open')) {
        railTipStore.set(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      railTipStore.set({ label, top: Math.round(rect.top + rect.height / 2) });
    },
    [railTipStore],
  );

  const hideRailTip = useCallback(() => railTipStore.set(null), [railTipStore]);

  const selectTab = useCallback(
    (tab: RoomTab, fromTab: RoomTab = activeTab) => {
      if (tab === fromTab && !tabTransition.running.current) return;
      tabTransition.run(() => {
        setActiveTab(tab);
        if (currentRoomId && currentRoomWorkspaceId) {
          changeRoute({ workspaceId: currentRoomWorkspaceId, roomId: currentRoomId, tab });
        }
      }, tabDirection(fromTab, tab));
    },
    [activeTab, changeRoute, currentRoomId, currentRoomWorkspaceId, tabTransition],
  );

  const handleRoomTabKeyDown = useCallback(
    (tab: RoomTab, event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const nextTab = getNextRoomTab(tab, event.key, event);
      if (!nextTab) return;
      event.preventDefault();
      roomTabButtonRefs.current[nextTab]?.focus();
      selectTab(nextTab, tab);
    },
    [selectTab],
  );

  const roomTabPanelProps = useCallback(
    (tab: RoomTab) => ({
      id: roomPanelElementId(tab),
      role: 'tabpanel' as const,
      'aria-labelledby': roomTabElementId(tab),
      inert: activeTab !== tab,
      className: `tab-pane ${activeTab === tab ? 'active' : 'hidden'}`,
    }),
    [activeTab],
  );

  useLayoutEffect(() => {
    const panel = filesPanelRef.current;
    if (!panel) return;
    syncEmptyTabPanelTabIndex(panel);
    const observer = new MutationObserver(() => syncEmptyTabPanelTabIndex(panel));
    observer.observe(panel, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'href'],
    });
    return () => observer.disconnect();
  }, [currentRoomId, activeTab, roomReadOnly, peersCount]);

  return {
    requestedRoute,
    changeRoute,
    compactLayout,
    activeTab,
    setActiveTab,
    roomTabsRef: roomTabsRef as RefObject<HTMLDivElement | null>,
    roomTabButtonRefs,
    filesPanelRef,
    isRightPanelOpen,
    setIsRightPanelOpen,
    sidebarCollapsed,
    isSidebarOpen,
    setIsSidebarOpen,
    sidebarExpanded,
    sidebarVisible,
    isCompactRail,
    toggleSidebar,
    railTipStore,
    showRailTip,
    hideRailTip,
    selectTab,
    handleRoomTabKeyDown,
    roomTabPanelProps,
  };
}
