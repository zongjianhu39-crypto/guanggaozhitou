// 移动端导航栏切换
document.addEventListener('DOMContentLoaded', function() {
  const hamburger = document.querySelector('.mobile-menu-btn');
  const navMenu = document.querySelector('.nav-menu');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hero = document.querySelector('.home-page .home-hero');
  const roleCards = Array.from(document.querySelectorAll('.home-page .role-card[data-role]'));
  const entryCards = Array.from(document.querySelectorAll('.home-page .home-entry-grid .entry-card[data-roles]'));
  const roleBridge = document.getElementById('entry-role-bridge');
  const roleBridgeBadge = roleBridge ? roleBridge.querySelector('.entry-role-badge') : null;
  const roleBridgeCopy = roleBridge ? roleBridge.querySelector('.entry-role-copy') : null;

  const roleDescriptions = {
    trader: {
      label: '投手',
      copy: '先看数据看板，再继续跑 AI 分析；如果需要复盘，再回看洞察中心。'
    },
    operator: {
      label: '运营',
      copy: '先看洞察中心抓最近变化，再回到指南或 Prompt 管理，补齐复盘和协同动作。'
    },
    manager: {
      label: '管理者',
      copy: '先看洞察中心快速抓结果和风险，必要时再进数据看板确认实时表现。'
    }
  };

  if (hamburger) {
    hamburger.setAttribute('aria-expanded', 'false');
    if (navMenu) hamburger.setAttribute('aria-controls', navMenu.id || 'nav-menu');

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

  function applyRoleView(role) {
    if (!roleDescriptions[role]) {
      return;
    }

    roleCards.forEach(function(card) {
      const isActive = card.dataset.role === role;
      card.classList.toggle('is-active', isActive);
      card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    entryCards.forEach(function(card) {
      const roles = (card.dataset.roles || '').split(',').map(function(value) {
        return value.trim();
      }).filter(Boolean);
      const isRecommended = roles.includes(role);
      card.classList.toggle('is-recommended', isRecommended);
      card.classList.toggle('is-muted', !isRecommended);
    });

    if (roleBridge && roleBridgeBadge && roleBridgeCopy) {
      roleBridge.dataset.activeRole = role;
      roleBridgeBadge.textContent = '当前推荐：' + roleDescriptions[role].label;
      roleBridgeCopy.textContent = roleDescriptions[role].copy;
    }
  }

  if (roleCards.length && entryCards.length) {
    roleCards.forEach(function(card) {
      card.addEventListener('click', function(event) {
        if (event.target.closest('a')) {
          return;
        }
        applyRoleView(card.dataset.role);
        if (window.innerWidth <= 768) {
          const systemEntry = document.getElementById('system-entry');
          if (systemEntry) {
            systemEntry.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
          }
        }
      });

      card.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        applyRoleView(card.dataset.role);
      });
    });

    applyRoleView('trader');
  }

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
