document.addEventListener('DOMContentLoaded', () => {
  const profile = document.getElementById('hero-profile');
  const title = document.getElementById('hero-title');
  const greeting = document.getElementById('hero-greeting'); // The "Hey👋" span
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // "Hey👋" Interaction Logic
  if (profile && greeting && title) {
    // 1. Wrap the emoji in a span if not already done
    if (!greeting.querySelector('.wave-emoji')) {
        const text = greeting.innerText;
        const parts = text.split('👋');
        if (parts.length > 0) {
            // Reconstruct HTML: "Hey" + wrapped emoji
            greeting.innerHTML = `${parts[0]}<span class="wave-emoji inline-block">👋</span>`;
        }
    }
    
    const emoji = greeting.querySelector('.wave-emoji');

    // 2. Define the Animation Functions
    const startWave = () => {
      // Web Animations API is out of reach of the CSS reduced-motion rule too.
      if (reduceMotion.matches) return;

      // Pop up the whole "Hey" text
      greeting.style.transform = 'translateY(-5px) scale(1.1)';

      // Animate the emoji waving
      if (emoji) {
        // .animate() cancels any currently running animation on the element automatically
        emoji.animate([
          { transform: 'rotate(0deg)' },
          { transform: 'rotate(20deg)' },
          { transform: 'rotate(-10deg)' },
          { transform: 'rotate(14deg)' },
          { transform: 'rotate(-4deg)' },
          { transform: 'rotate(10deg)' }, 
          { transform: 'rotate(0deg)' }
        ], {
          duration: 1000,
          easing: 'ease-in-out',
          iterations: 1
        });
      }
    };

    const endWave = () => {
      // Smoothly return to normal
      greeting.style.transform = 'translateY(0) scale(1)';
    };

    // 3. Attach Listeners to BOTH elements
    // Profile Picture Interaction
    profile.addEventListener('mouseenter', startWave);
    profile.addEventListener('mouseleave', endWave);

    // H1 Title Interaction
    title.addEventListener('mouseenter', startWave);
    title.addEventListener('mouseleave', endWave);
  }
});
