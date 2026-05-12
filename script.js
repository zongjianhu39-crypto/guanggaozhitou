// 移动端导航栏切换
document.addEventListener('DOMContentLoaded', function() {
  const hamburger = document.querySelector('.mobile-menu-btn');
  const navMenu = document.querySelector('.nav-menu');
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = motionQuery.matches;
  motionQuery.addEventListener('change', (e) => {
      reduceMotion = e.matches;
  });
  const hero = document.querySelector('.home-page .home-hero');

  if (hamburger && navMenu) {
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-controls', navMenu.id || 'nav-menu');

    hamburger.addEventListener('click', function() {
      const isActive = hamburger.classList.toggle('active');
      navMenu.classList.toggle('active');
      hamburger.setAttribute('aria-expanded', String(isActive));
    });

    // 点击菜单项后关闭菜单
    document.querySelectorAll('.nav-menu a').forEach(link => {
      link.addEventListener('click', function() {
        hamburger.classList.remove('active');
        navMenu.classList.remove('active');
      });
    });
  }

  document.querySelectorAll('.nav-item-dropdown').forEach(function(dropdown) {
    const trigger = dropdown.querySelector('button.nav-link[aria-expanded]');
    if (!trigger) return;

    function setExpanded(expanded) {
      trigger.setAttribute('aria-expanded', String(expanded));
    }

    dropdown.addEventListener('mouseenter', function() {
      setExpanded(true);
    });
    dropdown.addEventListener('mouseleave', function() {
      setExpanded(false);
    });
    dropdown.addEventListener('focusin', function() {
      setExpanded(true);
    });
    dropdown.addEventListener('focusout', function(event) {
      if (!dropdown.contains(event.relatedTarget)) {
        setExpanded(false);
      }
    });
  });

  document.querySelectorAll('[data-action="logout"]').forEach(function(link) {
    link.addEventListener('click', function(event) {
      event.preventDefault();
      if (window.authHelpers && window.authHelpers.logout) {
        window.authHelpers.logout();
        return;
      }
      window.location.replace('auth/index.html');
    });
  });

  const revealTargets = document.querySelectorAll([
    '.home-page .home-hero-copy',
    '.home-page .home-hero-stage',
    '.home-page .home-signal-bar > *',
    '.home-page .home-role-intro',
    '.home-page .home-role-grid > *',
    '.home-page .home-why-copy',
    '.home-page .home-why-stack > *',
    '.home-page .home-flow-copy',
    '.home-page .home-flow-rail > *',
    '.home-page .home-entry-grid > *',
    '.home-page .proof-story',
    '.home-page .proof-matrix > *',
    '.home-page .home-insights-top > *',
    '.home-page .home-insights-toolbar',
    '.home-page .insights-preview-state',
    '.home-page .insights-preview-grid > *',
    '.home-page .footer-main > *',
    '.home-page .footer-bottom > *'
  ].join(','));

  if (revealTargets.length) {
    revealTargets.forEach(function(target, index) {
      target.classList.add('reveal-item');
      target.style.setProperty('--reveal-delay', String((index % 6) * 70) + 'ms');
    });

    if (reduceMotion || !('IntersectionObserver' in window)) {
      revealTargets.forEach(function(target) {
        target.classList.add('is-visible');
      });
    } else {
      const observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (!entry.isIntersecting) {
            return;
          }
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      }, {
        threshold: 0.16,
        rootMargin: '0px 0px -8% 0px'
      });

      revealTargets.forEach(function(target) {
        observer.observe(target);
      });
    }
  }

  if (!hero || reduceMotion) {
    return;
  }

  const stageImage = hero.querySelector('.hero-stage-visual img');
  const stageMetric = hero.querySelector('.hero-stage-metric');
  const stageNote = hero.querySelector('.hero-stage-note');
  const stageSummary = hero.querySelector('.hero-stage-summary');
  const heroLayers = [
    { element: stageSummary, x: 10, y: 16 },
    { element: stageImage, x: 14, y: 18, scale: 1.018 },
    { element: stageMetric, x: 18, y: 22 },
    { element: stageNote, x: -12, y: 18 }
  ].filter(function(layer) {
    return !!layer.element;
  });

  let pointerX = 0;
  let pointerY = 0;
  let ticking = false;

  function updateHeroParallax() {
    const scrollOffset = Math.min(window.scrollY, 320);
    const scrollFactor = scrollOffset / 320;

    heroLayers.forEach(function(layer) {
      const moveX = pointerX * layer.x;
      const moveY = pointerY * layer.y - scrollFactor * layer.y * 8;
      const scale = layer.scale || 1;
      layer.element.style.transform = 'translate3d(' + moveX.toFixed(2) + 'px, ' + moveY.toFixed(2) + 'px, 0) scale(' + scale + ')';
    });

    ticking = false;
  }

  function requestParallax() {
    if (ticking) {
      return;
    }
    ticking = true;
    window.requestAnimationFrame(updateHeroParallax);
  }

  hero.addEventListener('pointermove', function(event) {
    const rect = hero.getBoundingClientRect();
    pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    pointerY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    requestParallax();
  });

  hero.addEventListener('pointerleave', function() {
    pointerX = 0;
    pointerY = 0;
    requestParallax();
  });

  window.addEventListener('scroll', requestParallax, { passive: true });
  requestParallax();
});
