/* ===================================
   TEAMSTER HOMEPAGE INTERACTIONS
   Lazy-loaded module for homepage
   =================================== */

/**
 * Initialize homepage interactions
 * @returns {Function} Cleanup function to call when leaving homepage
 */
export function initHome() {
    const root = document.getElementById('homeRoot');
    if (!root) return () => {};

    const cleanupFns = [];

    // =====================
    // Smooth Parallax Effect
    // =====================
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const clouds = root.querySelectorAll('.home__cloud');
        const cards = root.querySelectorAll('.home__card');
        
        let ticking = false;
        let lastScrollY = 0;

        function onScroll() {
            lastScrollY = window.scrollY;
            
            if (!ticking) {
                requestAnimationFrame(() => {
                    // Subtle parallax on clouds
                    clouds.forEach((cloud, i) => {
                        const speed = 0.03 + (i * 0.01);
                        const yOffset = lastScrollY * speed;
                        cloud.style.transform = `translateY(${yOffset}px)`;
                    });

                    // Subtle parallax on hero cards
                    cards.forEach((card, i) => {
                        const baseTransform = card.dataset.baseTransform || '';
                        const speed = 0.02 + (i * 0.005);
                        const yOffset = lastScrollY * speed;
                        card.style.transform = `${baseTransform} translateY(${yOffset}px)`;
                    });

                    ticking = false;
                });
                ticking = true;
            }
        }

        // Store base transforms for cards
        cards.forEach(card => {
            const style = window.getComputedStyle(card);
            card.dataset.baseTransform = style.transform !== 'none' ? '' : '';
        });

        window.addEventListener('scroll', onScroll, { passive: true });
        cleanupFns.push(() => window.removeEventListener('scroll', onScroll));
    }

    // =====================
    // Card Hover Interactions
    // =====================
    const previewStack = root.querySelector('.home__preview-stack');
    
    if (previewStack) {
        const cards = previewStack.querySelectorAll('.home__card');
        
        cards.forEach((card, index) => {
            const onMouseEnter = () => {
                // Bring hovered card to front
                cards.forEach(c => c.style.zIndex = 1);
                card.style.zIndex = 10;
                card.style.transform = card.style.transform.replace(/scale\([^)]+\)/, '') + ' scale(1.02)';
            };

            const onMouseLeave = () => {
                // Reset z-index based on original position
                cards.forEach((c, i) => c.style.zIndex = 3 - i);
                card.style.transform = card.style.transform.replace(/scale\([^)]+\)/, '');
            };

            card.addEventListener('mouseenter', onMouseEnter);
            card.addEventListener('mouseleave', onMouseLeave);
            
            cleanupFns.push(() => {
                card.removeEventListener('mouseenter', onMouseEnter);
                card.removeEventListener('mouseleave', onMouseLeave);
            });
        });
    }

    // =====================
    // Module Cards Stagger Animation
    // =====================
    const modules = root.querySelectorAll('.home__module');
    
    if (modules.length && 'IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry, i) => {
                if (entry.isIntersecting) {
                    setTimeout(() => {
                        entry.target.style.opacity = '1';
                        entry.target.style.transform = 'translateY(0)';
                    }, i * 100);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.2 });

        modules.forEach(mod => {
            mod.style.opacity = '0';
            mod.style.transform = 'translateY(20px)';
            mod.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            observer.observe(mod);
        });

        cleanupFns.push(() => observer.disconnect());
    }

    // =====================
    // CTA Section Cloud Animation Enhancement
    // =====================
    const ctaClouds = root.querySelectorAll('.home__cta-cloud');
    
    if (ctaClouds.length && 'IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                } else {
                    entry.target.style.opacity = '0.5';
                }
            });
        }, { threshold: 0.3 });

        ctaClouds.forEach(cloud => {
            cloud.style.transition = 'opacity 0.8s ease';
            observer.observe(cloud);
        });

        cleanupFns.push(() => observer.disconnect());
    }

    // =====================
    // Smooth CTA Button Interactions
    // =====================
    const ctaButtons = root.querySelectorAll('.home__cta');
    
    ctaButtons.forEach(btn => {
        const onMouseMove = (e) => {
            const rect = btn.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            
            btn.style.transform = `translateY(-1px) translateX(${x * 0.05}px) translateY(${y * 0.05}px)`;
        };

        const onMouseLeave = () => {
            btn.style.transform = '';
        };

        btn.addEventListener('mousemove', onMouseMove);
        btn.addEventListener('mouseleave', onMouseLeave);
        
        cleanupFns.push(() => {
            btn.removeEventListener('mousemove', onMouseMove);
            btn.removeEventListener('mouseleave', onMouseLeave);
        });
    });

    // =====================
    // Nav Background on Scroll
    // =====================
    const nav = root.querySelector('.home__nav');
    
    if (nav) {
        let navTicking = false;
        
        const onNavScroll = () => {
            if (!navTicking) {
                requestAnimationFrame(() => {
                    if (window.scrollY > 50) {
                        nav.style.background = 'rgba(255, 255, 255, 0.85)';
                        nav.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
                    } else {
                        nav.style.background = 'rgba(255, 255, 255, 0.7)';
                        nav.style.boxShadow = 'none';
                    }
                    navTicking = false;
                });
                navTicking = true;
            }
        };

        window.addEventListener('scroll', onNavScroll, { passive: true });
        cleanupFns.push(() => window.removeEventListener('scroll', onNavScroll));
    }

    // =====================
    // Typing Effect for Subtitle (optional enhancement)
    // =====================
    // Keeping this disabled by default - can be enabled if desired
    /*
    const subtitle = root.querySelector('.home__subtitle');
    if (subtitle) {
        const text = subtitle.textContent;
        subtitle.textContent = '';
        let i = 0;
        const typeInterval = setInterval(() => {
            if (i < text.length) {
                subtitle.textContent += text.charAt(i);
                i++;
            } else {
                clearInterval(typeInterval);
            }
        }, 20);
        cleanupFns.push(() => clearInterval(typeInterval));
    }
    */

    // =====================
    // Return Cleanup Function
    // =====================
    return function cleanup() {
        cleanupFns.forEach(fn => fn());
        
        // Reset any inline styles we added
        const clouds = root.querySelectorAll('.home__cloud');
        clouds.forEach(cloud => cloud.style.transform = '');
        
        const cards = root.querySelectorAll('.home__card');
        cards.forEach(card => {
            card.style.transform = '';
            card.style.zIndex = '';
        });
        
        const modules = root.querySelectorAll('.home__module');
        modules.forEach(mod => {
            mod.style.opacity = '';
            mod.style.transform = '';
            mod.style.transition = '';
        });

        if (nav) {
            nav.style.background = '';
            nav.style.boxShadow = '';
        }
    };
}

/**
 * Preload homepage assets for faster subsequent navigation
 */
export function preloadHomeAssets() {
    // Preload CSS
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = '/home/home.css';
    document.head.appendChild(link);
}
