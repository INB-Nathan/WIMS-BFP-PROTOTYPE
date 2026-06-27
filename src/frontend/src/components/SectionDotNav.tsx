'use client';

import { useEffect, useRef, useState } from 'react';

export interface SectionDotNavLink {
  id: string;
  label: string;
  observedIds?: string[];
}

interface SectionDotNavProps {
  links: readonly SectionDotNavLink[];
  ariaLabel?: string;
}

export function SectionDotNav({ links, ariaLabel = 'Page sections' }: SectionDotNavProps) {
  const [activeId, setActiveId] = useState(links[0]?.id ?? '');
  // Prevents the IntersectionObserver from overriding an explicit click while smooth-scrolling.
  const suppressRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const observerMap = links.reduce<Record<string, string>>((acc, link) => {
      (link.observedIds ?? [link.id]).forEach((id) => {
        acc[id] = link.id;
      });
      return acc;
    }, {});

    const sections = Object.keys(observerMap)
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));

    if (!sections.length) return;

    // Track all currently intersecting sections and pick the topmost one.
    const intersectingSet = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            intersectingSet.set(entry.target.id, entry.boundingClientRect.top);
          } else {
            intersectingSet.delete(entry.target.id);
          }
        });

        if (suppressRef.current) return;

        if (intersectingSet.size === 0) return;

        // Pick the element whose top is closest to (but still below) the top of the viewport.
        let bestId: string | null = null;
        let bestTop = Infinity;
        intersectingSet.forEach((top, id) => {
          const absTop = Math.abs(top);
          if (absTop < bestTop) {
            bestTop = absTop;
            bestId = id;
          }
        });

        const navId = bestId ? observerMap[bestId] : null;
        if (navId) setActiveId(navId);
      },
      { rootMargin: '-10% 0px -50% 0px', threshold: [0, 0.1, 0.25, 0.5, 1] },
    );

    sections.forEach((section) => observer.observe(section));

    // When the user has scrolled to (or near) the very bottom of the page, activate
    // the last nav dot. The IntersectionObserver's rootMargin clips the bottom 50% of
    // the viewport, so the final section never enters the detection zone when it sits
    // at the absolute bottom with little content below it.
    const lastId = links[links.length - 1].id;
    const handleScroll = () => {
      if (suppressRef.current) return;
      const { scrollY, innerHeight } = window;
      const { scrollHeight } = document.documentElement;
      if (scrollHeight - scrollY - innerHeight < 120) {
        setActiveId(lastId);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', handleScroll);
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    };
  }, [links]);

  const scrollToSection = (sectionId: string) => {
    // Optimistic update so the dot lights up immediately on click.
    setActiveId(sectionId);
    // Suppress observer for ~700 ms while smooth scroll animates.
    suppressRef.current = true;
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = setTimeout(() => {
      suppressRef.current = false;
    }, 700);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!links.length) return null;

  return (
    <nav
      className="fixed right-6 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-3 xl:flex 2xl:right-8"
      aria-label={ariaLabel}
    >
      {links.map(({ id, label }) => (
        <a
          key={id}
          href={`#${id}`}
          onClick={(event) => {
            event.preventDefault();
            scrollToSection(id);
          }}
          aria-label={label}
          title={label}
          className="group relative flex h-8 w-8 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700/40"
        >
          <span
            className={`h-3.5 w-3.5 rounded-full border shadow-sm transition-all duration-200 motion-safe:group-hover:scale-125 motion-safe:group-focus:scale-125 ${
              activeId === id
                ? 'border-[#1A3263] bg-[#1A3263] ring-4 ring-blue-100'
                : 'border-slate-400 bg-white group-hover:border-[#1A3263] group-focus:border-[#1A3263] group-hover:bg-[#E8E2DB] group-focus:bg-[#E8E2DB]'
            }`}
          />
          <span className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 opacity-0 shadow-sm transition-all duration-150 group-hover:-translate-x-2 group-hover:opacity-100 group-focus:-translate-x-2 group-focus:opacity-100">
            {label}
          </span>
        </a>
      ))}
    </nav>
  );
}
