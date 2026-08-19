document.addEventListener('DOMContentLoaded', () => {

  /* Reveal ao rolar — roda primeiro e isolado: se qualquer outro bloco
     abaixo falhar, o conteúdo da página já não fica preso em opacidade 0. */
  try {
    const revealEls = document.querySelectorAll('.reveal');
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach(el => revealObserver.observe(el));
  } catch (err) {
    console.error('Falha no reveal ao rolar:', err);
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-visible'));
  }

  /* Ano no rodapé */
  try {
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  } catch (err) { console.error('Falha ao definir o ano:', err); }

  /* Header com fundo ao rolar + botão voltar ao topo */
  try {
    const header = document.getElementById('header');
    const backToTop = document.getElementById('backToTop');
    const onScroll = () => {
      header.classList.toggle('is-scrolled', window.scrollY > 20);
      backToTop.classList.toggle('is-visible', window.scrollY > 500);
    };
    window.addEventListener('scroll', onScroll);
    onScroll();
    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  } catch (err) { console.error('Falha no header/voltar ao topo:', err); }

  /* Contadores animados */
  try {
    const counters = document.querySelectorAll('.counter');
    const animateCounter = (el) => {
      const target = parseInt(el.dataset.target, 10);
      const duration = 1400;
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(eased * target);
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(el => counterObserver.observe(el));
  } catch (err) { console.error('Falha nos contadores animados:', err); }

  /* FAQ accordion */
  try {
    document.querySelectorAll('.faq-item__question').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const isOpen = item.classList.contains('is-open');
        document.querySelectorAll('.faq-item').forEach(i => {
          i.classList.remove('is-open');
          i.querySelector('.faq-item__question').setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) {
          item.classList.add('is-open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });
  } catch (err) { console.error('Falha no FAQ:', err); }

  /* Validação do formulário de contato */
  try {
    const form = document.getElementById('contactForm');
    const successMsg = document.getElementById('formSuccess');

    const validators = {
      name: (v) => v.trim().length >= 3 || 'Informe seu nome completo.',
      email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Informe um e-mail válido.',
      phone: (v) => v.replace(/\D/g, '').length >= 10 || 'Informe um telefone válido com DDD.',
      message: (v) => v.trim().length >= 10 || 'Conte um pouco mais (mín. 10 caracteres).'
    };

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        let isValid = true;

        Object.keys(validators).forEach(field => {
          const input = form.elements[field];
          const errorEl = input.closest('.form-row').querySelector('.form-error');
          const result = validators[field](input.value);
          if (result !== true) {
            input.classList.add('is-invalid');
            errorEl.textContent = result;
            isValid = false;
          } else {
            input.classList.remove('is-invalid');
            errorEl.textContent = '';
          }
        });

        if (!isValid) return;

        successMsg.classList.add('is-visible');
        form.reset();
        setTimeout(() => successMsg.classList.remove('is-visible'), 6000);

        /*
          Sem backend próprio: integre aqui com seu serviço de envio
          (ex: Formspree, EmailJS, ou uma rota de API própria).
        */
      });
    }
  } catch (err) { console.error('Falha no formulário de contato:', err); }
});
