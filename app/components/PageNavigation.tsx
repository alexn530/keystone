"use client";

import { Icon } from "../icons";
import {
  externalHrefFor,
  getNavItem,
  getNextSection,
  getPreviousSection,
  navigatePreservingRun,
  shouldShowBackToWorkspace,
  type NavSectionId,
} from "../lib/nav/navigation";

export type PageNavigationProps = {
  currentSection: NavSectionId;
  activeRunId: string;
  onNavigate: (section: NavSectionId) => void;
};

export function PageNavigation({ currentSection, activeRunId, onNavigate }: PageNavigationProps) {
  const hasRun = Boolean(activeRunId);
  const prev = getPreviousSection(currentSection, { hasRun });
  const next = getNextSection(currentSection, { hasRun });
  const showBack = shouldShowBackToWorkspace(currentSection);

  if (!prev && !next && !showBack) return null;

  const handleNavigate = (target: NavSectionId) => {
    const item = getNavItem(target);
    if (item?.external) {
      const href = externalHrefFor(target, activeRunId);
      if (href && typeof window !== "undefined") window.location.assign(href);
      return;
    }
    onNavigate(target);
    navigatePreservingRun(activeRunId);
  };

  const prevItem = prev ? getNavItem(prev) : undefined;
  const nextItem = next ? getNavItem(next) : undefined;

  return <nav className="page-navigation" aria-label="Page navigation">
    <div className="page-navigation-inner">
      {prev && prevItem
        ? <button type="button" className="page-nav-button prev" onClick={() => handleNavigate(prev)}>
            <span className="page-nav-arrow"><Icon name="chevron" size={14} /></span>
            <span className="page-nav-copy">
              <small>PREVIOUS</small>
              <strong>{prevItem.label}</strong>
            </span>
          </button>
        : <span className="page-nav-placeholder" aria-hidden="true" />}

      {showBack && <button
        type="button"
        className="page-nav-button back"
        onClick={() => handleNavigate("workspace")}
        aria-label="Back to Agent Workspace"
      >
        <Icon name="spark" size={15} />
        <span>Back to Agent Workspace</span>
      </button>}

      {next && nextItem
        ? <button type="button" className="page-nav-button next" onClick={() => handleNavigate(next)}>
            <span className="page-nav-copy">
              <small>NEXT</small>
              <strong>{nextItem.label}</strong>
            </span>
            <span className="page-nav-arrow"><Icon name="arrow" size={15} /></span>
          </button>
        : <span className="page-nav-placeholder" aria-hidden="true" />}
    </div>
  </nav>;
}
