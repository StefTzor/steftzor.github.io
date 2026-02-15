document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('hero-canvas');
  const heroSection = document.getElementById('hero-section');
  const profile = document.getElementById('hero-profile');
  const title = document.getElementById('hero-title');
  const greeting = document.getElementById('hero-greeting'); // The "Hey👋" span

  if (!canvas || !heroSection) return;

  const ctx = canvas.getContext('2d');
  let width, height;
  let points = [];
  
  // Track mouse. Initialize off-screen so no effects start immediately.
  let mouse = { x: -5000, y: -5000, clientX: null, clientY: null }; 

  // --- CONFIGURATION ---
  const gap = 60; 
  const mouseRadius = 200; 
  const mouseStrength = 0.4; 
  const returnSpeed = 0.05;
  
  // Parallax Config
  const profileSpeed = 0.03; 
  const titleSpeed = 0.015;
  const colors = {
    start: { r: 16, g: 185, b: 129 }, // Green
    end: { r: 59, g: 130, b: 246 }    // Blue
  };

  // --- RESIZE & INIT ---
  const resize = () => {
    width = canvas.width = heroSection.offsetWidth;
    height = canvas.height = heroSection.offsetHeight;
    initGrid();
  };

  const initGrid = () => {
    points = [];
    const cols = Math.ceil(width / gap) + 1;
    const rows = Math.ceil(height / gap) + 1;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        points.push({
          x: x * gap,
          y: y * gap,
          originX: x * gap,
          originY: y * gap,
          vx: 0,
          vy: 0
        });
      }
    }
  };

  // --- ANIMATION LOOP ---
  const animate = () => {
    ctx.clearRect(0, 0, width, height);
    
    // 1. Canvas Physics (Grid Distortion)
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const dist = Math.hypot(dx, dy);

      if (dist < mouseRadius) {
        const angle = Math.atan2(dy, dx);
        const force = (mouseRadius - dist) / mouseRadius;
        const push = force * mouseStrength * 20;
        p.vx -= Math.cos(angle) * push;
        p.vy -= Math.sin(angle) * push;
      }

      p.vx += (p.originX - p.x) * returnSpeed;
      p.vy += (p.originY - p.y) * returnSpeed;
      p.vx *= 0.9;
      p.vy *= 0.9;
      p.x += p.vx;
      p.y += p.vy;
    }

    // 2. Draw Polygons
    const cols = Math.ceil(width / gap) + 1;
    for (let i = 0; i < points.length; i++) {
      if ((i + 1) % cols === 0 || i >= points.length - cols) continue;
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + cols];
      const p4 = points[i + cols + 1];

      const ratio = p1.x / width;
      const r = Math.round(colors.start.r + (colors.end.r - colors.start.r) * ratio);
      const g = Math.round(colors.start.g + (colors.end.g - colors.start.g) * ratio);
      const b = Math.round(colors.start.b + (colors.end.b - colors.start.b) * ratio);
      const alpha = Math.max(0, 1 - (p1.y / height));

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.15})`;
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.3})`;

      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p2.x, p2.y); ctx.lineTo(p4.x, p4.y); ctx.lineTo(p3.x, p3.y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    // 3. DOM Elements Parallax (Only if mouse is active inside section)
    if (mouse.clientX !== null && profile && title) {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      
      const deltaX = (mouse.clientX - centerX);
      const deltaY = (mouse.clientY - centerY);

      // We use 'translate3d' for better hardware acceleration
      // The profile moves slightly up (-Y) to give it that "floating" feel
      profile.style.transform = `translate3d(${deltaX * profileSpeed}px, ${deltaY * profileSpeed}px, 0) scale(1.05)`;
      title.style.transform = `translate3d(${deltaX * titleSpeed}px, ${deltaY * titleSpeed}px, 0)`;
    }

    requestAnimationFrame(animate);
  };

  // --- EVENTS ---
  window.addEventListener('resize', resize);
  
  // Mouse Move
  heroSection.addEventListener('mousemove', (e) => {
    const rect = heroSection.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    mouse.clientX = e.clientX;
    mouse.clientY = e.clientY;
  });

  // Mouse Leave (RESET EVERYTHING)
  heroSection.addEventListener('mouseleave', () => {
    // Reset canvas physics target off-screen
    mouse.x = -5000;
    mouse.y = -5000;
    mouse.clientX = null;
    mouse.clientY = null;

    // Smoothly reset DOM elements to center
    if (profile) profile.style.transform = 'translate3d(0, 0, 0) scale(1)';
    if (title) title.style.transform = 'translate3d(0, 0, 0)';
  });

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

  // Init
  resize();
  animate();
});