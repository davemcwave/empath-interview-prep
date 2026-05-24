/**
 * Empath Interview Prep - script.js
 * Pure vanilla JS. No dependencies.
 * GitHub Pages compatible.
 */

(function () {
  'use strict';

  /* ============================================================
     STICKY NAV - SCROLL CLASS TOGGLE
     Adds `.scrolled` to <nav> when the page scrolls past threshold,
     enabling backdrop blur + shadow via CSS.
  ============================================================ */
  const nav = document.getElementById('nav');

  function handleNavScroll() {
    if (!nav) return;
    if (window.scrollY > 20) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  }

  // Passive listener for performance
  window.addEventListener('scroll', handleNavScroll, { passive: true });
  // Run once on load in case page is already scrolled (e.g. refresh mid-page)
  handleNavScroll();


  /* ============================================================
     MOBILE HAMBURGER MENU
     Toggles `.is-open` on the nav links container and hamburger button.
     Also closes the menu on Escape key and when clicking outside.
  ============================================================ */
  const hamburger  = document.getElementById('hamburger');
  const navLinks   = document.getElementById('navLinks');

  function openMenu() {
    if (!hamburger || !navLinks) return;
    navLinks.classList.add('is-open');
    hamburger.classList.add('is-open');
    hamburger.setAttribute('aria-expanded', 'true');
    hamburger.setAttribute('aria-label', 'Close navigation menu');
    document.body.style.overflow = 'hidden'; // Prevent scroll while menu is open
  }

  function closeMenu() {
    if (!hamburger || !navLinks) return;
    navLinks.classList.remove('is-open');
    hamburger.classList.remove('is-open');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-label', 'Open navigation menu');
    document.body.style.overflow = '';
  }

  function toggleMenu() {
    const isOpen = hamburger.getAttribute('aria-expanded') === 'true';
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  if (hamburger) {
    hamburger.addEventListener('click', toggleMenu);
  }

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeMenu();
    }
  });

  // Close when clicking outside the nav
  document.addEventListener('click', function (e) {
    if (!nav) return;
    const isOpen = hamburger && hamburger.getAttribute('aria-expanded') === 'true';
    if (isOpen && !nav.contains(e.target)) {
      closeMenu();
    }
  });

  // Close menu when a nav link is clicked (smooth-scroll to section)
  if (navLinks) {
    navLinks.querySelectorAll('.nav__link').forEach(function (link) {
      link.addEventListener('click', function () {
        closeMenu();
      });
    });
  }


  /* ============================================================
     SMOOTH SCROLL FOR ANCHOR LINKS
     Provides smooth scrolling with proper offset for sticky nav,
     as a progressive enhancement over CSS `scroll-behavior: smooth`.
     (CSS handles most cases; this adds nav-height offset precision.)
  ============================================================ */
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return; // Skip bare # links

      const target = document.querySelector(href);
      if (!target) return;

      e.preventDefault();

      const navHeight = nav ? nav.getBoundingClientRect().height : 68;
      const targetTop = target.getBoundingClientRect().top + window.scrollY - navHeight - 8;

      window.scrollTo({
        top: targetTop,
        behavior: 'smooth'
      });

      // Update URL without triggering scroll
      history.pushState(null, '', href);
    });
  });


  /* ============================================================
     SCROLL-TRIGGERED FADE-IN (IntersectionObserver)
     Observes elements with `.fade-in` class.
     Adds `.is-visible` when they enter the viewport.
     Skips hero children since they use CSS animation directly.
  ============================================================ */
  const fadeElements = document.querySelectorAll('.fade-in');

  // Respect reduced-motion preference
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    // Just make everything visible immediately
    fadeElements.forEach(function (el) {
      el.classList.add('is-visible');
    });
  } else {
    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            // Small stagger based on index within parent
            const siblings = Array.from(entry.target.parentElement.children);
            const index    = siblings.indexOf(entry.target);
            const delay    = Math.min(index * 80, 320); // max 320ms stagger

            setTimeout(function () {
              entry.target.classList.add('is-visible');
            }, delay);

            // Unobserve after triggering - no re-animation on scroll-up
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.12,       // Trigger when 12% is visible
        rootMargin: '0px 0px -40px 0px' // Slight bottom offset so it feels natural
      }
    );

    fadeElements.forEach(function (el) {
      // Hero section uses CSS animation directly; mark visible immediately
      if (el.closest('.hero')) {
        el.classList.add('is-visible');
        return;
      }
      observer.observe(el);
    });
  }


  /* ============================================================
     MORE SERVICES TOGGLE
     Expands the secondary services grid with a smooth height transition.
  ============================================================ */
  const moreToggle = document.getElementById('moreServicesToggle');
  const moreGrid   = document.getElementById('moreServicesGrid');

  if (moreToggle && moreGrid) {
    moreToggle.addEventListener('click', function () {
      const isExpanded = moreToggle.getAttribute('aria-expanded') === 'true';

      if (isExpanded) {
        // Collapse
        moreGrid.classList.remove('is-open');
        moreGrid.setAttribute('aria-hidden', 'true');
        moreToggle.setAttribute('aria-expanded', 'false');
        moreToggle.querySelector('.services__more-toggle-text').textContent = 'Show more services';
      } else {
        // Expand
        moreGrid.classList.add('is-open');
        moreGrid.setAttribute('aria-hidden', 'false');
        moreToggle.setAttribute('aria-expanded', 'true');
        moreToggle.querySelector('.services__more-toggle-text').textContent = 'Show fewer services';

        // Trigger fade-in for newly visible cards if not already done
        if (!prefersReducedMotion) {
          const hiddenCards = moreGrid.querySelectorAll('.fade-in:not(.is-visible)');
          hiddenCards.forEach(function (card, i) {
            setTimeout(function () {
              card.classList.add('is-visible');
            }, i * 80);
          });
        }
      }
    });
  }


  /* ============================================================
     ACTIVE NAV LINK HIGHLIGHT (Scroll-Spy)
     Adds `aria-current="page"` to the active nav link based on
     which section is currently in view.
  ============================================================ */
  const sections    = document.querySelectorAll('section[id]');
  const navAnchors  = document.querySelectorAll('.nav__link[href^="#"]');

  function updateActiveLink() {
    const scrollY     = window.scrollY;
    const navH        = nav ? nav.getBoundingClientRect().height : 68;
    let   currentId   = '';

    sections.forEach(function (section) {
      const sectionTop = section.offsetTop - navH - 40;
      if (scrollY >= sectionTop) {
        currentId = section.getAttribute('id');
      }
    });

    navAnchors.forEach(function (anchor) {
      const href = anchor.getAttribute('href').replace('#', '');
      if (href === currentId) {
        anchor.setAttribute('aria-current', 'page');
        anchor.style.color = 'var(--color-text)';
      } else {
        anchor.removeAttribute('aria-current');
        anchor.style.color = '';
      }
    });
  }

  window.addEventListener('scroll', updateActiveLink, { passive: true });
  updateActiveLink();


  /* ============================================================
     INITIALIZE
     Run on DOMContentLoaded to ensure all elements exist.
  ============================================================ */
  // Already using DOMContentLoaded via IIFE + script at bottom of body.
  // Nothing else needed here - all selectors are safe.

})();
